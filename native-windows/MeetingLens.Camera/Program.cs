using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;

namespace MeetingLens.Camera;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.Ordinal)) return HostSelfTest.Run();
        if (args.Contains("--provider-smoke-test", StringComparer.Ordinal)) return SmokeTests.Provider();
        if (args.Contains("--camera-smoke-test", StringComparer.Ordinal)) return SmokeTests.CameraAsync().GetAwaiter().GetResult();
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22621))
        {
            MessageBox.Show("MeetingLens Virtual Camera requires Windows 11 version 22H2 or newer.", "MeetingLens", MessageBoxButton.OK, MessageBoxImage.Information);
            return 1;
        }
        using var singleInstance = new Mutex(true, @"Local\MeetingLens.Camera.Host", out var firstInstance);
        if (!firstInstance)
        {
            MessageBox.Show("MeetingLens Camera is already running. Use its existing window to control meeting output.", "MeetingLens", MessageBoxButton.OK, MessageBoxImage.Information);
            return 0;
        }
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.Run(new CameraWindow());
        return 0;
    }
}

internal static class HostSelfTest
{
    public static int Run()
    {
        try
        {
            Span<byte> header = stackalloc byte[FrameProtocol.HeaderBytes];
            FrameProtocol.WriteHeader(header, 17, 123456);
            if (header[0] != (byte)'M' || header[1] != (byte)'L' || header[6] != 40 || !FrameProtocol.IsFresh(1000, 1749) || FrameProtocol.IsFresh(1000, 1750))
                throw new InvalidOperationException("Header or freshness checks failed.");
            if (MessageContract.TryParse("{\"protocol\":\"1\"}", "test-session", out _)) throw new InvalidOperationException("Malformed message accepted.");
            Console.WriteLine(JsonSerializer.Serialize(new { test = "host-self-test", passed = true, scope = "frame-header-freshness-message-validation", platform = Environment.OSVersion.VersionString }));
            return 0;
        }
        catch (Exception exception)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { test = "host-self-test", passed = false, error = exception.Message }));
            return 1;
        }
    }
}

internal static class SmokeTests
{
    public static int Provider()
    {
        nint provider = 0;
        var initialized = false;
        try
        {
            VirtualCameraRegistration.ThrowIfFailed(CoInitializeEx(0, 2), "COM could not initialize for the provider smoke test");
            initialized = true;
            var clsid = FrameProtocol.ProviderClsid;
            var iid = new Guid("7FEE9E9A-4A89-47A6-899C-B6A53A70FB67"); // IMFActivate
            VirtualCameraRegistration.ThrowIfFailed(CoCreateInstance(ref clsid, 0, 1, ref iid, out provider), "Registered MeetingLens IMFActivate provider could not load");
            Console.WriteLine(JsonSerializer.Serialize(new { test = "provider-com-activation", passed = true, clsid, scope = "COM IMFActivate only; no physical camera capture" }));
            return 0;
        }
        catch (Exception exception)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { test = "provider-com-activation", passed = false, error = exception.Message, hresult = $"0x{exception.HResult:X8}" }));
            return 1;
        }
        finally
        {
            if (provider != 0) Marshal.Release(provider);
            if (initialized) CoUninitialize();
        }
    }

    public static async Task<int> CameraAsync()
    {
        try
        {
            var frames = new FrameStore();
            await using var pipe = new FramePipeServer(frames);
            await using var registration = new VirtualCameraRegistration();
            await registration.StartAsync(pipe.PipeName);
            await registration.VerifyEnumeratedAsync();
            await registration.StopAsync();
            Console.WriteLine(JsonSerializer.Serialize(new { test = "virtual-camera-register-enumerate-stop", passed = true, scope = "Windows session registration, exact device enumeration and lifecycle; not a Teams or Zoom capture certification" }));
            return 0;
        }
        catch (Exception exception)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { test = "virtual-camera-register-start-stop", passed = false, error = exception.Message, hresult = $"0x{exception.HResult:X8}" }));
            return 1;
        }
    }

    [DllImport("ole32.dll", ExactSpelling = true)]
    private static extern int CoCreateInstance(ref Guid classId, nint outer, uint context, ref Guid interfaceId, out nint result);
    [DllImport("ole32.dll", ExactSpelling = true)] private static extern int CoInitializeEx(nint reserved, uint coInit);
    [DllImport("ole32.dll", ExactSpelling = true)] private static extern void CoUninitialize();
}
