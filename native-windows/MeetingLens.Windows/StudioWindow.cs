using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using Windows.Devices.Enumeration;
using Windows.Graphics.Imaging;
using Windows.Media.Capture;
using Windows.Media.Capture.Frames;
using Windows.Media.Devices;
using Windows.Media.MediaProperties;
using Windows.Storage.Streams;
using WinBuffer = Windows.Storage.Streams.Buffer;

namespace MeetingLens.Windows;

internal sealed class StudioWindow : Window
{
    private readonly ComboBox _devices = new() { MinWidth = 240, DisplayMemberPath = "Name" };
    private readonly ComboBox _formats = new() { MinWidth = 220 };
    private readonly Button _connect = new() { Content = "Connect camera" };
    private readonly Button _disconnect = new() { Content = "Disconnect", IsEnabled = false };
    private readonly Button _refresh = new() { Content = "Refresh devices" };
    private readonly Button _export = new() { Content = "Export capability report", IsEnabled = false };
    private readonly TextBlock _status = new() { Text = "Choose a camera, then connect.", TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _zoomLabel = new() { Text = "Hardware zoom — not connected" };
    private readonly TextBlock _frameLabel = new() { Text = "Preview inactive" };
    private readonly Image _preview = new() { Stretch = Stretch.Uniform, MinHeight = 280 };
    private readonly ComboBox _auto = new() { IsEnabled = false };
    private readonly Slider _zoom = new() { IsEnabled = false, Width = 260 };
    private readonly Dictionary<EffectDefinition, ComboBox> _effects = new();
    private readonly Dictionary<string, (ulong Original, ulong LastSet)> _changed = new();
    private MediaCapture? _capture;
    private MediaFrameReader? _reader;
    private MediaFrameSource? _source;
    private DeviceInformation? _selectedDevice;
    private (DigitalWindowMode Original, DigitalWindowMode LastSet)? _changedAuto;
    private (float Original, float LastSet)? _changedZoom;
    private List<FormatItem> _availableFormats = [];
    private WriteableBitmap? _bitmap;
    private bool _updating;
    private bool _busy;
    private bool _closing;
    private int _rendering;
    private long _lastRender;

    internal StudioWindow()
    {
        Title = "MeetingLens · Windows camera controls";
        Width = 1180;
        Height = 820;
        MinWidth = 760;
        MinHeight = 640;
        Background = Brush("#101823");
        Foreground = Brush("#EDF4FF");
        FontFamily = new FontFamily("Segoe UI");
        FontSize = 14;
        var root = new DockPanel { Margin = new Thickness(24) };
        Content = root;
        var header = new StackPanel { Margin = new Thickness(0, 0, 0, 20) };
        DockPanel.SetDock(header, Dock.Top);
        root.Children.Add(header);
        header.Children.Add(new TextBlock { Text = "MEETINGLENS / WINDOWS", FontSize = 12, Foreground = Brush("#69D8BF") });
        header.Children.Add(new TextBlock { Text = "Your camera. Its real capabilities.", FontSize = 28, FontWeight = FontWeights.SemiBold });
        header.Children.Add(Note("Native control utility · Windows 11 22H2+ · Supported effects are supplied by your camera driver and Windows."));
        var toolbar = new WrapPanel { Margin = new Thickness(0, 14, 0, 0) };
        header.Children.Add(toolbar);
        foreach (var control in new Control[] { _devices, _connect, _disconnect, _refresh, _export })
        {
            control.Margin = new Thickness(0, 0, 8, 8);
            control.Padding = new Thickness(10, 7, 10, 7);
            toolbar.Children.Add(control);
        }
        var footer = new StackPanel { Margin = new Thickness(0, 16, 0, 0) };
        DockPanel.SetDock(footer, Dock.Bottom);
        root.Children.Add(footer);
        footer.Children.Add(_status);
        footer.Children.Add(Note("Effect and zoom changes belong to this connection. On disconnect, MeetingLens attempts to restore only the values it changed and only if another app has not changed them again."));
        var settings = new WrapPanel();
        footer.Children.Add(settings);
        var cameraSettings = MakeButton("Windows camera settings", (_, _) => Launch("ms-settings:camera"));
        var soundSettings = MakeButton("Voice Focus / sound settings", (_, _) => Launch("ms-settings:sound"));
        var selectedSettings = MakeButton("Selected camera settings", (_, _) =>
            Launch(_selectedDevice is null ? "ms-settings:camera" : "ms-settings:camera?cameraId=" + Uri.EscapeDataString(_selectedDevice.Id)));
        settings.Children.Add(cameraSettings);
        settings.Children.Add(selectedSettings);
        settings.Children.Add(soundSettings);
        settings.Children.Add(MakeButton("Multi-app / basic camera options", (_, _) =>
        {
            Launch(_selectedDevice is null ? "ms-settings:camera" : "ms-settings:camera?cameraId=" + Uri.EscapeDataString(_selectedDevice.Id));
            _status.Text = "In Windows camera settings, open Advanced camera options. Multi-app and Basic camera options depend on Windows version and policy. Disconnect this utility before testing meeting apps.";
        }));
        settings.Children.Add(MakeButton("DirectShow diagnostics", async (_, _) =>
        {
            if (_busy) return;
            await DisconnectAsync();
            var diagnostic = Path.Combine(AppContext.BaseDirectory, "MeetingLens.BasicCamera.exe");
            if (!File.Exists(diagnostic)) { _status.Text = "DirectShow diagnostics executable is missing. Run native-windows/build.ps1 with the C++ desktop tools installed."; return; }
            try
            {
                Process.Start(new ProcessStartInfo(diagnostic, "--interactive") { UseShellExecute = true });
                _status.Text = "DirectShow diagnostics opened. Choose the camera explicitly in its console; this path does not guarantee unprocessed pixels.";
            }
            catch (Exception error) { _status.Text = "Could not open diagnostics: " + error.Message; }
        }));

        var columns = new Grid();
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 280 });
        root.Children.Add(columns);
        var left = new DockPanel { Margin = new Thickness(0, 0, 20, 0) };
        columns.Children.Add(left);
        var capture = new StackPanel();
        DockPanel.SetDock(capture, Dock.Bottom);
        left.Children.Add(capture);
        capture.Children.Add(_frameLabel);
        capture.Children.Add(Note("Video modes reported by the selected driver"));
        _formats.Margin = new Thickness(0, 4, 0, 0);
        _formats.IsEnabled = false;
        capture.Children.Add(_formats);
        left.Children.Add(new Border { Background = Brushes.Black, CornerRadius = new CornerRadius(12), Child = _preview });
        var right = new StackPanel();
        var scroll = new ScrollViewer { Content = right, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Grid.SetColumn(scroll, 1);
        columns.Children.Add(scroll);
        right.Children.Add(new TextBlock { Text = "Windows Studio controls", FontSize = 18, FontWeight = FontWeights.SemiBold });
        right.Children.Add(Note("Unsupported controls stay unavailable. Windows manages NPU acceleration; MeetingLens does not emulate eye contact."));
        foreach (var definition in KsControl.Effects)
        {
            var select = new ComboBox { IsEnabled = false, Margin = new Thickness(0, 5, 0, 14) };
            _effects.Add(definition, select);
            right.Children.Add(new TextBlock { Text = definition.Label });
            right.Children.Add(select);
            select.SelectionChanged += async (_, _) => await ChangeEffectAsync(definition, select);
        }
        right.Children.Add(new TextBlock { Text = "Automatic framing" });
        _auto.Margin = new Thickness(0, 5, 0, 14);
        right.Children.Add(_auto);
        right.Children.Add(_zoomLabel);
        right.Children.Add(_zoom);
        right.Children.Add(Note("Zoom uses the exact minimum, maximum and step advertised by the device. Unsupported resolutions and driver modes are never unlocked."));
        right.Children.Add(new TextBlock { Text = "System options", FontSize = 18, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 16, 0, 0) });
        right.Children.Add(Note("Voice Focus and multi-app camera settings are managed by Windows on supported devices. The settings buttons below open those controls. This utility is separate from the PWA and does not route the PWA canvas into meetings."));

        Loaded += async (_, _) => await RefreshDevicesAsync();
        _refresh.Click += async (_, _) => await RefreshDevicesAsync();
        _connect.Click += async (_, _) => await ConnectAsync();
        _disconnect.Click += async (_, _) => await DisconnectAsync();
        _export.Click += (_, _) => ExportReport();
        _auto.SelectionChanged += async (_, _) => await ChangeAutoAsync();
        _formats.SelectionChanged += async (_, _) => await ChangeFormatAsync();
        // Commit on pointer release / key release: do not flood the driver with slider changes.
        _zoom.PreviewMouseLeftButtonUp += async (_, _) => await ChangeZoomAsync();
        _zoom.PreviewKeyUp += async (_, _) => await ChangeZoomAsync();
        Closing += async (_, args) =>
        {
            if (_closing) return;
            args.Cancel = true;
            if (_busy)
            {
                _status.Text = "Finishing a camera operation. Close again when it completes.";
                return;
            }
            IsEnabled = false;
            await DisconnectAsync();
            _closing = true;
            Close();
        };
    }

    private static SolidColorBrush Brush(string value) => (SolidColorBrush)new BrushConverter().ConvertFromString(value)!;
    private static TextBlock Note(string text) => new() { Text = text, TextWrapping = TextWrapping.Wrap,
        Foreground = Brush("#AEBCCF"), FontSize = 12, Margin = new Thickness(0, 8, 0, 10) };
    private static Button MakeButton(string title, RoutedEventHandler action)
    {
        var button = new Button { Content = title, Margin = new Thickness(0, 8, 8, 0), Padding = new Thickness(10, 6, 10, 6) };
        button.Click += action;
        return button;
    }
    private void Launch(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
        catch (Exception error) { _status.Text = "Windows settings could not open: " + error.Message; }
    }

    private async Task RefreshDevicesAsync()
    {
        if (_busy || _capture is not null) return;
        _busy = true;
        try
        {
            _devices.ItemsSource = (await DeviceInformation.FindAllAsync(MediaDevice.GetVideoCaptureSelector())).ToList();
            _devices.SelectedIndex = _devices.Items.Count > 0 ? 0 : -1;
            _status.Text = _devices.Items.Count > 0 ? "Choose any built-in or USB camera and connect." : "No camera found. Connect a webcam and refresh.";
        }
        catch (Exception error) { _status.Text = "Could not list cameras: " + error.Message; }
        finally { _busy = false; }
    }

    private async Task ConnectAsync()
    {
        if (_busy || _capture is not null || _devices.SelectedItem is not DeviceInformation device) return;
        _busy = true;
        _connect.IsEnabled = false;
        _refresh.IsEnabled = false;
        _devices.IsEnabled = false;
        _status.Text = "Opening camera. Windows may request camera permission…";
        try
        {
            _selectedDevice = device;
            _capture = new MediaCapture();
            _capture.Failed += CaptureFailed;
            await _capture.InitializeAsync(new MediaCaptureInitializationSettings
            {
                VideoDeviceId = device.Id,
                StreamingCaptureMode = StreamingCaptureMode.Video,
                SharingMode = MediaCaptureSharingMode.ExclusiveControl,
                MemoryPreference = MediaCaptureMemoryPreference.Cpu
            });
            _source = _capture.FrameSources.Values.FirstOrDefault(source => source.Info.SourceKind == MediaFrameSourceKind.Color && source.Info.MediaStreamType == MediaStreamType.VideoPreview)
                ?? _capture.FrameSources.Values.FirstOrDefault(source => source.Info.SourceKind == MediaFrameSourceKind.Color && source.Info.MediaStreamType == MediaStreamType.VideoRecord)
                ?? throw new NotSupportedException("No readable color preview or record source is available.");
            _availableFormats = _source.SupportedFormats.Select(format => new FormatItem(format)).ToList();
            if (_availableFormats.Count == 0) throw new NotSupportedException("No video formats are available.");
            // Keep the driver's default, avoiding a speculative high-bandwidth mode at startup.
            _reader = await _capture.CreateFrameReaderAsync(_source, MediaEncodingSubtypes.Bgra8);
            _reader.AcquisitionMode = MediaFrameReaderAcquisitionMode.Realtime;
            _reader.FrameArrived += FrameArrived;
            if (await _reader.StartAsync() != MediaFrameReaderStartStatus.Success)
                throw new InvalidOperationException("Windows could not start the camera reader. Close other camera apps and try again.");
            RefreshControls();
            _disconnect.IsEnabled = true;
            _export.IsEnabled = true;
            _status.Text = "Connected. Inspect current system effects before enabling any duplicate effect in your meeting app.";
        }
        catch (Exception error)
        {
            await ReleaseAsync();
            _status.Text = "Camera unavailable: " + error.Message + " Check Windows camera privacy permissions and close competing camera apps.";
            ResetConnectionButtons();
        }
        finally { _busy = false; }
    }

    private void RefreshControls()
    {
        if (_capture is null || _source is null) return;
        _updating = true;
        try
        {
            var controller = _capture.VideoDeviceController;
            foreach (var (definition, select) in _effects)
            {
                var state = KsControl.Read(controller, definition);
                select.ItemsSource = state.Supported ? state.Modes : new[] { "Unavailable on this camera" };
                select.IsEnabled = state.Supported && state.Modes.Length > 1;
                select.ToolTip = state.Error ?? "Current device state, queried through Kernel Streaming.";
                select.SelectedItem = definition.Modes.FirstOrDefault(mode => mode.Value == state.Flags).Key;
                if (select.SelectedIndex < 0 && !state.Supported) select.SelectedIndex = 0;
            }
            var digital = controller.DigitalWindowControl;
            _auto.ItemsSource = digital.IsSupported ? digital.SupportedModes.Where(mode => mode is DigitalWindowMode.Off or DigitalWindowMode.Auto).Select(mode => mode.ToString()).ToArray() : new[] { "Unavailable on this camera" };
            _auto.IsEnabled = digital.IsSupported && digital.SupportedModes.Contains(DigitalWindowMode.Auto);
            _auto.SelectedItem = digital.IsSupported ? digital.CurrentMode.ToString() : "Unavailable on this camera";
            var zoom = controller.ZoomControl;
            _zoom.IsEnabled = zoom.Supported;
            if (zoom.Supported)
            {
                _zoom.Minimum = zoom.Min;
                _zoom.Maximum = zoom.Max;
                _zoom.TickFrequency = zoom.Step > 0 ? zoom.Step : 0.01;
                _zoom.SmallChange = _zoom.TickFrequency;
                _zoom.IsSnapToTickEnabled = zoom.Step > 0;
                _zoom.Value = zoom.Value;
                _zoomLabel.Text = $"Hardware zoom: {zoom.Value:0.###}  ({zoom.Min:0.###}–{zoom.Max:0.###}, step {zoom.Step:0.###})";
            }
            else _zoomLabel.Text = "Hardware zoom — unavailable on this camera";
            _formats.ItemsSource = _availableFormats;
            _formats.SelectedItem = _availableFormats.FirstOrDefault(item => SameFormat(item.Format, _source.CurrentFormat));
            _formats.IsEnabled = true;
        }
        finally { _updating = false; }
    }

    private static bool SameFormat(MediaFrameFormat a, MediaFrameFormat b) => a.Subtype == b.Subtype &&
        a.VideoFormat.Width == b.VideoFormat.Width && a.VideoFormat.Height == b.VideoFormat.Height &&
        a.FrameRate.Numerator == b.FrameRate.Numerator && a.FrameRate.Denominator == b.FrameRate.Denominator;

    private async Task ChangeEffectAsync(EffectDefinition effect, ComboBox select)
    {
        if (_updating || _busy || _capture is null || select.SelectedItem is not string mode || !effect.Modes.TryGetValue(mode, out var flags)) return;
        _busy = true;
        try
        {
            var controller = _capture.VideoDeviceController;
            var before = KsControl.Read(controller, effect);
            if (!before.Supported || before.Flags is not ulong original) throw new NotSupportedException(before.Error);
            KsControl.Write(controller, effect, flags);
            var restore = _changed.TryGetValue(effect.Id, out var previous) ? previous.Original : original;
            _changed[effect.Id] = (restore, flags);
            _status.Text = $"{effect.Label}: {mode}. Camera confirmed the change.";
        }
        catch (Exception error) { _status.Text = error.Message; }
        finally { _busy = false; RefreshControls(); }
        await Task.CompletedTask;
    }

    private async Task ChangeAutoAsync()
    {
        if (_updating || _busy || _capture is null || _auto.SelectedItem is not string text || !Enum.TryParse<DigitalWindowMode>(text, out var mode)) return;
        _busy = true;
        try
        {
            var control = _capture.VideoDeviceController.DigitalWindowControl;
            if (!control.IsSupported || !control.SupportedModes.Contains(mode)) throw new NotSupportedException("Automatic framing is not supported.");
            var original = _changedAuto?.Original ?? control.CurrentMode;
            control.Configure(mode);
            if (control.CurrentMode != mode) throw new InvalidOperationException("Camera did not confirm the framing mode.");
            _changedAuto = (original, mode);
            _status.Text = "Automatic framing: " + mode;
        }
        catch (Exception error) { _status.Text = error.Message; }
        finally { _busy = false; RefreshControls(); }
        await Task.CompletedTask;
    }

    private async Task ChangeZoomAsync()
    {
        if (_updating || _busy || _capture is null || !_zoom.IsEnabled) return;
        _busy = true;
        try
        {
            var control = _capture.VideoDeviceController.ZoomControl;
            var value = Math.Clamp((float)_zoom.Value, control.Min, control.Max);
            if (control.Step > 0) value = control.Min + MathF.Round((value - control.Min) / control.Step) * control.Step;
            value = Math.Clamp(value, control.Min, control.Max);
            var original = _changedZoom?.Original ?? control.Value;
            control.Value = value;
            _changedZoom = (original, control.Value);
            _status.Text = "Hardware zoom applied at the driver's supported step.";
        }
        catch (Exception error) { _status.Text = "Zoom rejected: " + error.Message; }
        finally { _busy = false; RefreshControls(); }
        await Task.CompletedTask;
    }

    private async Task ChangeFormatAsync()
    {
        if (_updating || _busy || _capture is null || _source is null || _reader is null || _formats.SelectedItem is not FormatItem selection || SameFormat(selection.Format, _source.CurrentFormat)) return;
        _busy = true;
        var previous = _source.CurrentFormat;
        try
        {
            await _reader.StopAsync();
            await _source.SetFormatAsync(selection.Format);
            if (await _reader.StartAsync() != MediaFrameReaderStartStatus.Success) throw new InvalidOperationException("Could not restart this mode.");
            _status.Text = "Video mode changed to " + selection;
        }
        catch (Exception error)
        {
            try
            {
                await _reader.StopAsync();
                await _source.SetFormatAsync(previous);
                if (await _reader.StartAsync() != MediaFrameReaderStartStatus.Success) throw new InvalidOperationException("Recovery failed.");
                _status.Text = "That mode was rejected; previous mode restored. " + error.Message;
            }
            catch { await ReleaseAsync(); ResetConnectionButtons(); _status.Text = "Camera mode recovery failed. Reconnect the camera."; }
        }
        finally { _busy = false; RefreshControls(); }
    }

    private void FrameArrived(MediaFrameReader sender, MediaFrameArrivedEventArgs args)
    {
        using var frame = sender.TryAcquireLatestFrame();
        var bitmap = frame?.VideoMediaFrame?.SoftwareBitmap;
        if (bitmap is null || Interlocked.Exchange(ref _rendering, 1) != 0) return;
        try
        {
            var now = Environment.TickCount64;
            if (now - _lastRender < 80) return; // Bound WPF preview work to at most 12.5 fps.
            _lastRender = now;
            using var converted = SoftwareBitmap.Convert(bitmap, BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
            var width = converted.PixelWidth;
            var height = converted.PixelHeight;
            var stride = checked(width * 4);
            var bytes = new byte[checked(stride * height)];
            var buffer = new WinBuffer((uint)bytes.Length);
            converted.CopyToBuffer(buffer);
            using (var reader = DataReader.FromBuffer(buffer)) reader.ReadBytes(bytes);
            Dispatcher.Invoke(() =>
            {
                if (_capture is null || _closing) return;
                if (_bitmap is null || _bitmap.PixelWidth != width || _bitmap.PixelHeight != height)
                {
                    _bitmap = new WriteableBitmap(width, height, 96, 96, PixelFormats.Pbgra32, null);
                    _preview.Source = _bitmap;
                }
                _bitmap.WritePixels(new Int32Rect(0, 0, width, height), bytes, stride, 0);
                _frameLabel.Text = $"{width} × {height} · {(_source?.CurrentFormat.Subtype ?? "BGRA")} · Preview limit 12.5 fps";
            });
        }
        catch (Exception error)
        {
            Dispatcher.BeginInvoke(new Action(() => _status.Text = "Preview frame skipped: " + error.Message));
        }
        finally { Interlocked.Exchange(ref _rendering, 0); }
    }

    private void CaptureFailed(MediaCapture sender, MediaCaptureFailedEventArgs error)
    {
        Dispatcher.BeginInvoke(new Action(async () =>
        {
            if (!ReferenceEquals(sender, _capture)) return;
            if (_busy) { _status.Text = $"Camera error ({error.Code}): {error.Message}"; return; }
            await DisconnectAsync();
            _status.Text = $"Camera disconnected or driver failed ({error.Code}): {error.Message}. Refresh devices and reconnect.";
        }));
    }

    private void ExportReport()
    {
        if (_capture is null || _source is null || _selectedDevice is null) return;
        var dialog = new SaveFileDialog { FileName = "MeetingLens-Windows-Capabilities.json", Filter = "JSON report|*.json" };
        if (dialog.ShowDialog(this) != true) return;
        try
        {
            var controller = _capture.VideoDeviceController;
            var digital = controller.DigitalWindowControl;
            var zoom = controller.ZoomControl;
            var report = new
            {
                schema = "meetinglens.windows.capabilities.v1",
                generatedAt = DateTimeOffset.UtcNow,
                platform = "Windows",
                osVersion = Environment.OSVersion.VersionString,
                source = "MeetingLens.Windows",
                device = new { name = _selectedDevice.Name, idHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(_selectedDevice.Id)))[..16] },
                effects = KsControl.Effects.Select(effect => KsControl.Read(controller, effect)).ToArray(),
                autoFraming = new { supported = digital.IsSupported && digital.SupportedModes.Contains(DigitalWindowMode.Auto), currentMode = digital.IsSupported ? digital.CurrentMode.ToString() : null },
                zoom = new { supported = zoom.Supported, minimum = zoom.Supported ? zoom.Min : (float?)null, maximum = zoom.Supported ? zoom.Max : (float?)null, step = zoom.Supported ? zoom.Step : (float?)null, value = zoom.Supported ? zoom.Value : (float?)null },
                formats = _availableFormats.Select(item => new { width = item.Format.VideoFormat.Width, height = item.Format.VideoFormat.Height, subtype = item.Format.Subtype, numerator = item.Format.FrameRate.Numerator, denominator = item.Format.FrameRate.Denominator }).ToArray(),
                voiceFocus = new { status = "windows-settings", controlledByCompanion = false },
                npu = new { status = "managed-by-windows", appSelectsExecutionProvider = false },
                virtualCamera = new { status = "source-reference-not-integrated", routesPwaCanvas = false },
                notes = new[] { "This is a point-in-time camera capability report, not a live connection to the PWA.", "Do not apply duplicate app blur when system backgroundBlur is active.", "Unsupported effects remain unavailable; camera support can change after driver or Windows updates." }
            };
            File.WriteAllText(dialog.FileName, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
            _status.Text = "Capability report saved locally. It contains camera capabilities and a hashed device id, no video or audio.";
        }
        catch (Exception error) { _status.Text = "Report could not be saved: " + error.Message; }
    }

    private async Task DisconnectAsync()
    {
        if (_busy) return;
        _busy = true;
        await ReleaseAsync();
        ResetConnectionButtons();
        _status.Text = "Disconnected. Camera released.";
        _busy = false;
    }

    private async Task ReleaseAsync()
    {
        var capture = _capture;
        var reader = _reader;
        // Prevent stale frames from reaching WPF while teardown waits for the frame reader.
        _capture = null;
        _reader = null;
        if (reader is not null)
        {
            reader.FrameArrived -= FrameArrived;
            try { await reader.StopAsync(); } catch { /* A device unplug can invalidate the reader. */ }
            try { reader.Dispose(); } catch { /* Still release the owning capture after an invalidated reader. */ }
        }
        if (capture is not null)
        {
            try
            {
                var controller = capture.VideoDeviceController;
                foreach (var effect in KsControl.Effects)
                {
                    if (!_changed.TryGetValue(effect.Id, out var state)) continue;
                    try
                    {
                        // Do not overwrite a change made by another client during the session.
                        if (KsControl.Read(controller, effect).Flags == state.LastSet)
                            KsControl.Write(controller, effect, state.Original, restore: true);
                    }
                    catch { /* Best effort only: disconnected devices cannot accept restoration. */ }
                }
                if (_changedAuto is { } auto && controller.DigitalWindowControl.CurrentMode == auto.LastSet)
                    controller.DigitalWindowControl.Configure(auto.Original);
                if (_changedZoom is { } zoom && Math.Abs(controller.ZoomControl.Value - zoom.LastSet) < 0.0001)
                    controller.ZoomControl.Value = zoom.Original;
            }
            catch { /* A driver failure may prevent restoration, but capture still must be released. */ }
            capture.Failed -= CaptureFailed;
            try { capture.Dispose(); } catch { /* A driver can disappear while Windows releases it. */ }
        }
        _source = null;
        _bitmap = null;
        _preview.Source = null;
        _changed.Clear();
        _changedAuto = null;
        _changedZoom = null;
    }

    private void ResetConnectionButtons()
    {
        _connect.IsEnabled = true;
        _refresh.IsEnabled = true;
        _devices.IsEnabled = true;
        _disconnect.IsEnabled = false;
        _export.IsEnabled = false;
        _formats.IsEnabled = false;
        _auto.IsEnabled = false;
        _zoom.IsEnabled = false;
        foreach (var select in _effects.Values) select.IsEnabled = false;
        _frameLabel.Text = "Preview inactive";
    }

    private sealed record FormatItem(MediaFrameFormat Format)
    {
        public override string ToString() => $"{Format.VideoFormat.Width} × {Format.VideoFormat.Height} · {(Format.FrameRate.Denominator == 0 ? 0 : (double)Format.FrameRate.Numerator / Format.FrameRate.Denominator):0.##} fps · {Format.Subtype}";
    }
}
