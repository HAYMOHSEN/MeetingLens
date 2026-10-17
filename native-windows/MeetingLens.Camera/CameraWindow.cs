using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace MeetingLens.Camera;

internal sealed class CameraWindow : Window
{
    private readonly WebView2 browser = new();
    private readonly Button startButton = new() { Content = "Enable virtual camera", Padding = new Thickness(18, 9, 18, 9), IsEnabled = false };
    private readonly Button stopButton = new() { Content = "Disable virtual camera", Padding = new Thickness(18, 9, 18, 9), Margin = new Thickness(10, 0, 0, 0), IsEnabled = false };
    private readonly Button returnButton = new() { Content = "Camera studio", Padding = new Thickness(12, 9, 12, 9), Margin = new Thickness(10, 0, 0, 0), Visibility = Visibility.Collapsed };
    private readonly TextBlock status = new() { Text = "Loading the local camera app…", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(18, 0, 0, 0), TextWrapping = TextWrapping.Wrap };
    private readonly FrameStore frames = new();
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    private readonly DispatcherTimer pump;
    private readonly byte[] rgba = new byte[FrameProtocol.PayloadBytes];
    private FramePipeServer? pipe;
    private VirtualCameraRegistration? registration;
    private CoreWebView2SharedBuffer? sharedBuffer;
    private string sessionId = "";
    private ulong sequence;
    private ulong pendingSequence;
    private long requestedAt;
    private bool pageReady;
    private bool closing;
    private bool closeAllowed;
    private bool transition;
    private bool browserLive;
    private int receivedFrames;
    private long rateSince = Environment.TickCount64;

    public CameraWindow()
    {
        Title = "MeetingLens — Windows Virtual Camera";
        Width = 1400; Height = 900; MinWidth = 920; MinHeight = 640;
        Background = new SolidColorBrush(Color.FromRgb(14, 19, 31));
        var panel = new DockPanel();
        var toolbar = new DockPanel { Margin = new Thickness(12) };
        DockPanel.SetDock(startButton, Dock.Left); DockPanel.SetDock(stopButton, Dock.Left); DockPanel.SetDock(returnButton, Dock.Left);
        toolbar.Children.Add(startButton); toolbar.Children.Add(stopButton); toolbar.Children.Add(returnButton); toolbar.Children.Add(status);
        var bar = new Border { Child = toolbar, Background = Brushes.White };
        DockPanel.SetDock(bar, Dock.Top); panel.Children.Add(bar); panel.Children.Add(browser); Content = panel;
        pump = new DispatcherTimer(DispatcherPriority.Normal) { Interval = TimeSpan.FromMilliseconds(1000.0 / 30) };
        pump.Tick += (_, _) => PullFrame();
        Loaded += async (_, _) => await InitializeAsync();
        startButton.Click += async (_, _) => await StartAsync();
        stopButton.Click += async (_, _) => await StopAsync();
        returnButton.Click += (_, _) => browser.CoreWebView2.Navigate(MessageContract.Origin + "/index.html");
        Closing += async (_, args) =>
        {
            if (closeAllowed) return;
            args.Cancel = true;
            if (closing) return;
            closing = true;
            frames.Black();
            await StopAsync();
            browser.Dispose();
            closeAllowed = true;
            Close();
        };
    }

    private async Task InitializeAsync()
    {
        try
        {
            var webRoot = Path.Combine(AppContext.BaseDirectory, "web");
            if (!File.Exists(Path.Combine(webRoot, "index.html"))) throw new FileNotFoundException("The bundled web/index.html is missing. Reinstall the complete MeetingLens Windows package.");
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MeetingLens", "Camera", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await browser.EnsureCoreWebView2Async(environment);
            var core = browser.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsWebMessageEnabled = true;
            core.SetVirtualHostNameToFolderMapping("appassets.meetinglens.example", webRoot, CoreWebView2HostResourceAccessKind.DenyCors);
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.NavigationStarting += (_, args) =>
            {
                if (MessageContract.IsTrustedOrigin(args.Uri) && new Uri(args.Uri).AbsolutePath == "/")
                {
                    args.Cancel = true; core.Navigate(MessageContract.Origin + "/index.html"); return;
                }
                if (!MessageContract.IsLocalPage(args.Uri)) args.Cancel = true;
                if (args.Cancel) status.Text = args.Uri.StartsWith("ms-settings:", StringComparison.OrdinalIgnoreCase)
                    ? "Open Windows Settings manually to change camera or sound device settings."
                    : "This camera window opens bundled MeetingLens pages. Open external links in your normal browser.";
                // Navigation and reload invalidate all old shared buffers and
                // outstanding frames before any new script can run.
                if (!args.Cancel) { pageReady = false; frames.Black(); browserLive = false; pendingSequence = 0; }
            };
            core.NavigationCompleted += async (_, args) =>
            {
                pageReady = args.IsSuccess && MessageContract.IsTrustedDocument(core.Source);
                if (sessionId.Length != 0) await StopAsync();
                startButton.IsEnabled = pageReady && !closing;
                returnButton.Visibility = pageReady ? Visibility.Collapsed : Visibility.Visible;
                status.Text = pageReady ? "Enable the virtual camera, then start your camera and meeting output below." :
                    args.IsSuccess ? "Meeting output is disabled on this page. Return to Camera studio to reconnect." : "The local app could not load. Return to Camera studio or restart MeetingLens.";
            };
            core.PermissionRequested += (_, args) =>
            {
                // The trusted PWA asks only after its own explicit user action.
                // Keep WebView2/Windows consent prompts; do not silently grant.
                args.State = MessageContract.IsTrustedOrigin(args.Uri) && MessageContract.IsTrustedDocument(core.Source) &&
                    args.PermissionKind is CoreWebView2PermissionKind.Camera or CoreWebView2PermissionKind.Microphone
                    ? CoreWebView2PermissionState.Default : CoreWebView2PermissionState.Deny;
            };
            core.ProcessFailed += async (_, _) =>
            {
                frames.Black(); pageReady = false; await StopAsync();
                startButton.IsEnabled = false; status.Text = "The camera app stopped. Close and reopen MeetingLens before rejoining your meeting.";
            };
            core.WebMessageReceived += OnWebMessage;
            // The app is fully bundled. Reject remote subresources, uploads,
            // sockets, telemetry, and external iframes from this privileged view.
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, args) =>
            {
                if (Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var uri) &&
                    ((uri.Scheme == "https" && uri.Host == "appassets.meetinglens.example" && uri.IsDefaultPort) || uri.Scheme is "data" or "blob")) return;
                args.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Remote resources disabled", "Content-Type: text/plain");
            };
            core.Navigate(MessageContract.Origin + "/index.html");
        }
        catch (Exception exception)
        {
            frames.Black(); startButton.IsEnabled = false;
            status.Text = exception is WebView2RuntimeNotFoundException
                ? "Microsoft Edge WebView2 Runtime is required. Install the Evergreen Runtime from Microsoft and reopen MeetingLens."
                : exception.Message;
        }
    }

    private async Task StartAsync()
    {
        if (transition || !pageReady || closing || sessionId.Length != 0) return;
        transition = true; startButton.IsEnabled = false;
        await lifecycle.WaitAsync();
        status.Text = "Registering your Windows virtual camera…";
        try
        {
            frames.Black(); browserLive = false;
            pipe = new FramePipeServer(frames);
            registration = new VirtualCameraRegistration();
            await registration.StartAsync(pipe.PipeName);
            if (closing || !pageReady) throw new OperationCanceledException("The camera window closed during startup.");
            sessionId = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            sequence = 0; pendingSequence = 0; receivedFrames = 0; rateSince = Environment.TickCount64;
            sharedBuffer = browser.CoreWebView2.Environment.CreateSharedBuffer(FrameProtocol.PayloadBytes);
            browser.CoreWebView2.PostSharedBufferToScript(sharedBuffer, CoreWebView2SharedBufferAccess.ReadWrite,
                JsonSerializer.Serialize(new { type = "meetinglens.native.ready", protocol = 1, sessionId, width = FrameProtocol.Width, height = FrameProtocol.Height, fps = 30 }));
            stopButton.IsEnabled = true; pump.Start();
            status.Text = "Select MeetingLens Virtual Camera in Teams, Zoom, or Meet. Click Start meeting camera below to send video.";
        }
        catch (Exception exception)
        {
            await ReleaseAsync();
            status.Text = exception.Message;
            startButton.IsEnabled = pageReady && !closing;
        }
        finally { transition = false; lifecycle.Release(); }
    }

    private void PullFrame()
    {
        if (sessionId.Length == 0 || !pageReady || sharedBuffer is null || closing) return;
        var now = Environment.TickCount64;
        if (pendingSequence != 0)
        {
            if (now - requestedAt < FrameProtocol.RequestDeadlineMilliseconds) return;
            // Expired request can never authorize a late frame.
            pendingSequence = 0; frames.Black();
            if (browserLive) status.Text = "Waiting for the camera app — meeting output is black.";
        }
        if (sequence >= int.MaxValue)
        {
            frames.Black(); pump.Stop();
            status.Text = "Restart virtual camera output to renew this session.";
            return;
        }
        pendingSequence = ++sequence; requestedAt = now;
        try
        {
            browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "meetinglens.native.requestFrame", protocol = 1, sessionId, sequence = pendingSequence }));
        }
        catch (Exception exception) when (exception is System.Runtime.InteropServices.COMException or ObjectDisposedException or InvalidOperationException)
        {
            frames.Black(); pendingSequence = 0; pump.Stop();
            status.Text = "The camera app disconnected. Disable and enable the virtual camera to reconnect.";
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!pageReady || sessionId.Length == 0 || !MessageContract.IsTrustedDocument(args.Source) ||
            !MessageContract.TryParse(args.WebMessageAsJson, sessionId, out var message)) return;
        if (message.Type == "state")
        {
            browserLive = message.State == "live";
            if (!browserLive)
            {
                frames.Black(); pendingSequence = 0;
                status.Text = message.State == "privacy" ? "Privacy shield is on — meeting output is black." :
                    message.State == "blocked" ? "Waiting for a fresh processed camera frame — meeting output is black." : "Virtual camera enabled. Click Start meeting camera below to send video.";
            }
            return;
        }
        var now = Environment.TickCount64;
        if (!browserLive || sharedBuffer is null || pendingSequence == 0 || message.Sequence != pendingSequence ||
            now < requestedAt || now - requestedAt >= FrameProtocol.RequestDeadlineMilliseconds) return;
        try
        {
            using (var stream = sharedBuffer.OpenStream()) stream.ReadExactly(rgba);
            frames.PublishRgba(rgba, pendingSequence, requestedAt);
            pendingSequence = 0;
            receivedFrames++;
            if (now - rateSince >= 1000)
            {
                var fps = receivedFrames * 1000.0 / (now - rateSince);
                status.Text = $"MeetingLens Virtual Camera is live · 1280 × 720 · {fps:F0} output fps";
                rateSince = now; receivedFrames = 0;
            }
        }
        catch (Exception exception) when (exception is IOException or ObjectDisposedException or System.Runtime.InteropServices.COMException)
        {
            frames.Black(); pendingSequence = 0;
            status.Text = "The video transport stopped. Disable and enable the virtual camera to reconnect.";
        }
    }

    private async Task StopAsync()
    {
        // Black first, before any Windows lifecycle call can block.
        frames.Black(); browserLive = false; pendingSequence = 0; pump.Stop();
        stopButton.IsEnabled = false; startButton.IsEnabled = false;
        await lifecycle.WaitAsync();
        transition = true;
        var previousSession = sessionId; sessionId = "";
        try
        {
            if (previousSession.Length != 0 && pageReady)
            {
                try { browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "meetinglens.native.stop", protocol = 1, sessionId = previousSession })); }
                catch (Exception exception) when (exception is System.Runtime.InteropServices.COMException or ObjectDisposedException or InvalidOperationException) { }
            }
            await ReleaseAsync(); status.Text = "Virtual camera disabled.";
        }
        catch (Exception exception) { status.Text = "Camera output is black. Windows cleanup reported: " + exception.Message; }
        finally
        {
            transition = false; lifecycle.Release();
            startButton.IsEnabled = pageReady && !closing;
        }
    }

    private async Task ReleaseAsync()
    {
        frames.Black(); sessionId = ""; pendingSequence = 0;
        var buffer = sharedBuffer; sharedBuffer = null; Array.Clear(rgba);
        try { buffer?.Dispose(); }
        finally
        {
            try
            {
                if (registration is not null)
                {
                    var existing = registration; registration = null;
                    await existing.DisposeAsync();
                }
            }
            finally
            {
                if (pipe is not null)
                {
                    var existing = pipe; pipe = null;
                    await existing.DisposeAsync();
                }
            }
        }
    }
}
