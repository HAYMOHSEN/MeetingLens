using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace MeetingLens.Camera;

// All native camera lifecycle calls run on this dedicated MTA, never the WPF UI
// thread. MFCreateVirtualCamera can display the Windows camera consent UI.
internal sealed class VirtualCameraRegistration : IAsyncDisposable
{
    private readonly BlockingCollection<Action> queue = new();
    private readonly Thread thread;
    private nint camera;
    private bool mfStarted;

    public VirtualCameraRegistration()
    {
        thread = new Thread(Run) { IsBackground = true, Name = "MeetingLens Media Foundation" };
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
    }

    public Task StartAsync(string pipeName) => InvokeAsync(() =>
    {
        if (camera != 0) throw new InvalidOperationException("The virtual camera is already running.");
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22621))
            throw new PlatformNotSupportedException("MeetingLens Virtual Camera requires Windows 11 version 22H2 or newer.");
        ThrowIfFailed(MFStartup(0x00020070, 0), "Media Foundation could not start");
        mfStarted = true;
        try
        {
            // MFVirtualCameraType_SoftwareCameraSource=0; Session=0;
            // CurrentUser=0. No physical camera association or global device.
            ThrowIfFailed(MFCreateVirtualCamera(0, 0, 0, "MeetingLens Virtual Camera", FrameProtocol.ProviderClsid.ToString("B"), 0, 0, out camera),
                "The virtual camera could not be created. Run the supplied Windows installer first");
            var attribute = FrameProtocol.PipeAttribute;
            ThrowIfFailed(Method<SetStringDelegate>(25)(camera, ref attribute, pipeName), "The camera transport could not be configured");
            ThrowIfFailed(Method<StartDelegate>(36)(camera, 0),
                "The virtual camera could not start. Check Windows Settings > Privacy & security > Camera and verify the MeetingLens provider is installed");
        }
        catch { ReleaseCamera(); throw; }
    });

    public Task StopAsync() => InvokeAsync(ReleaseCamera);

    public Task VerifyEnumeratedAsync() => InvokeAsync(() =>
    {
        if (camera == 0) throw new InvalidOperationException("Start the virtual camera before enumeration.");
        var symbolicLinkKey = new Guid("58F0AAD8-22BF-4F8A-BB3D-D2C4978C6E2F");
        var expectedLink = ReadAllocatedString(camera, ref symbolicLinkKey);
        if (expectedLink.Length == 0) throw new InvalidOperationException("Windows did not return the virtual camera symbolic link.");
        nint attributes = 0, devices = 0;
        uint count = 0;
        try
        {
            ThrowIfFailed(MFCreateAttributes(out attributes, 1), "Camera enumeration attributes could not be created");
            var sourceType = new Guid("C60AC5FE-252A-478F-A0EF-BC8FA5F7CAD3");
            var videoCapture = new Guid("8AC3587A-4AE7-42D8-99E0-0A6013EEF90F");
            var setGuid = Marshal.GetDelegateForFunctionPointer<SetGuidDelegate>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(attributes), 24 * nint.Size));
            ThrowIfFailed(setGuid(attributes, ref sourceType, ref videoCapture), "Video capture enumeration could not be configured");
            ThrowIfFailed(MFEnumDeviceSources(attributes, out devices, out count), "Windows camera enumeration failed");
            var found = false;
            for (uint index = 0; index < count; index++)
            {
                var device = Marshal.ReadIntPtr(devices, checked((int)index * nint.Size));
                try
                {
                    if (string.Equals(ReadAllocatedString(device, ref symbolicLinkKey), expectedLink, StringComparison.OrdinalIgnoreCase)) found = true;
                }
                catch (COMException) { /* An unrelated device need not expose this attribute. */ }
            }
            if (!found) throw new InvalidOperationException("The started MeetingLens virtual camera was absent from Media Foundation device enumeration.");
        }
        finally
        {
            if (devices != 0)
            {
                for (uint index = 0; index < count; index++) Marshal.Release(Marshal.ReadIntPtr(devices, checked((int)index * nint.Size)));
                Marshal.FreeCoTaskMem(devices);
            }
            if (attributes != 0) Marshal.Release(attributes);
        }
    });

    private static string ReadAllocatedString(nint attributes, ref Guid key)
    {
        var getString = Marshal.GetDelegateForFunctionPointer<GetAllocatedStringDelegate>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(attributes), 13 * nint.Size));
        nint value = 0;
        try
        {
            ThrowIfFailed(getString(attributes, ref key, out value, out _), "Camera device identifier could not be read");
            return Marshal.PtrToStringUni(value) ?? "";
        }
        finally { if (value != 0) Marshal.FreeCoTaskMem(value); }
    }

    private T Method<T>(int slot) where T : Delegate => Marshal.GetDelegateForFunctionPointer<T>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(camera), slot * nint.Size));

    private void ReleaseCamera()
    {
        if (camera != 0)
        {
            // Stop disables enumeration. Remove cleans the session device even
            // when a meeting app still owns a source; Shutdown releases handles.
            _ = Method<NoArgumentsDelegate>(37)(camera);
            _ = Method<NoArgumentsDelegate>(38)(camera);
            _ = Method<NoArgumentsDelegate>(43)(camera);
            Marshal.Release(camera);
            camera = 0;
        }
        if (mfStarted) { _ = MFShutdown(); mfStarted = false; }
    }

    private void Run()
    {
        var result = CoInitializeEx(0, 0);
        try { foreach (var action in queue.GetConsumingEnumerable()) action(); }
        finally { if (result >= 0) CoUninitialize(); }
    }

    private Task InvokeAsync(Action action)
    {
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        queue.Add(() =>
        {
            try { action(); completion.SetResult(); }
            catch (Exception exception) { completion.SetException(exception); }
        });
        return completion.Task;
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync().ConfigureAwait(false);
        queue.CompleteAdding();
        // Completion and thread shutdown are bounded by the OS lifecycle calls.
        await Task.Run(thread.Join).ConfigureAwait(false);
        queue.Dispose();
    }

    internal static void ThrowIfFailed(int hr, string context)
    {
        if (hr < 0) throw new COMException($"{context} (0x{hr:X8}).", hr);
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Unicode)]
    private delegate int SetStringDelegate(nint instance, ref Guid key, [MarshalAs(UnmanagedType.LPWStr)] string value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int StartDelegate(nint instance, nint callback);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int NoArgumentsDelegate(nint instance);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SetGuidDelegate(nint instance, ref Guid key, ref Guid value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetAllocatedStringDelegate(nint instance, ref Guid key, out nint value, out uint length);
    [DllImport("mfsensorgroup.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int MFCreateVirtualCamera(int type, int lifetime, int access, [MarshalAs(UnmanagedType.LPWStr)] string friendlyName,
        [MarshalAs(UnmanagedType.LPWStr)] string sourceId, nint categories, uint categoryCount, out nint virtualCamera);
    [DllImport("mfplat.dll", ExactSpelling = true)] private static extern int MFStartup(uint version, uint flags);
    [DllImport("mfplat.dll", ExactSpelling = true)] private static extern int MFShutdown();
    [DllImport("mfplat.dll", ExactSpelling = true)] private static extern int MFCreateAttributes(out nint attributes, uint initialSize);
    [DllImport("mf.dll", ExactSpelling = true)] private static extern int MFEnumDeviceSources(nint attributes, out nint sources, out uint count);
    [DllImport("ole32.dll", ExactSpelling = true)] private static extern int CoInitializeEx(nint reserved, uint coInit);
    [DllImport("ole32.dll", ExactSpelling = true)] private static extern void CoUninitialize();
}
