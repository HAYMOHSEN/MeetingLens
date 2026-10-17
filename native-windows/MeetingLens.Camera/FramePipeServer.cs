using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace MeetingLens.Camera;

internal sealed class FramePipeServer : IAsyncDisposable
{
    private readonly FrameStore frames;
    private readonly CancellationTokenSource stop = new();
    private readonly List<Task> workers = [];
    public string PipeName { get; } = "MeetingLens.Camera." + Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));

    public FramePipeServer(FrameStore frames)
    {
        this.frames = frames;
        // Establish the first instance synchronously: registration cannot succeed
        // while the transport has silently failed because of an invalid ACL.
        var instances = new List<NamedPipeServerStream>();
        try
        {
            for (var index = 0; index < 8; index++) instances.Add(CreateServer(index == 0));
        }
        catch
        {
            foreach (var instance in instances) instance.Dispose();
            stop.Dispose();
            throw;
        }
        foreach (var instance in instances) workers.Add(ServeAsync(instance, stop.Token));
    }

    private NamedPipeServerStream CreateServer(bool firstInstance)
    {
        var user = WindowsIdentity.GetCurrent().User?.Value ?? throw new InvalidOperationException("The current Windows user identity is unavailable.");
        // LocalService may only exchange data. Do not grant its generic write
        // permission, which also grants FILE_CREATE_PIPE_INSTANCE (0x0004).
        var sddl = $"D:P(A;;FA;;;{user})(A;;0x12019B;;;LS)(A;;FA;;;SY)";
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out var descriptor, out _))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot secure the virtual camera transport.");
        try
        {
            var attributes = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), SecurityDescriptor = descriptor };
            const uint duplex = 3, overlapped = 0x40000000, rejectRemoteClients = 8, firstPipeInstance = 0x00080000;
            var handle = CreateNamedPipe(@"\\.\pipe\" + PipeName, duplex | overlapped | (firstInstance ? firstPipeInstance : 0),
                rejectRemoteClients, 8, 65536, 64, 1000, ref attributes);
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot create the virtual camera transport.");
            return new NamedPipeServerStream(PipeDirection.InOut, true, false, handle);
        }
        finally { LocalFree(descriptor); }
    }

    private async Task ServeAsync(NamedPipeServerStream pipe, CancellationToken cancellation)
    {
        using (pipe)
        {
            var request = new byte[4];
            var header = new byte[FrameProtocol.HeaderBytes];
            var payload = new byte[FrameProtocol.PayloadBytes];
            while (!cancellation.IsCancellationRequested)
            {
                try
                {
                    await pipe.WaitForConnectionAsync(cancellation).ConfigureAwait(false);
                    while (pipe.IsConnected && !cancellation.IsCancellationRequested)
                    {
                        // A peer cannot monopolize one of the eight bounded slots
                        // indefinitely by sending a partial command or not reading.
                        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                        deadline.CancelAfter(TimeSpan.FromSeconds(2));
                        await pipe.ReadExactlyAsync(request, deadline.Token).ConfigureAwait(false);
                        if (!request.AsSpan().SequenceEqual(FrameProtocol.Request)) break;
                        var frame = frames.CopyTo(payload, Environment.TickCount64);
                        FrameProtocol.WriteHeader(header, frame.Sequence, frame.Captured);
                        await pipe.WriteAsync(header, deadline.Token).ConfigureAwait(false);
                        await pipe.WriteAsync(payload, deadline.Token).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { }
                catch (IOException) { }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
                finally
                {
                    try { if (pipe.IsConnected) pipe.Disconnect(); }
                    catch (IOException) { }
                    Array.Clear(payload);
                }
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        frames.Black();
        await stop.CancelAsync().ConfigureAwait(false);
        await Task.WhenAll(workers).ConfigureAwait(false);
        stop.Dispose();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int Length;
        public nint SecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string descriptor, uint revision, out nint securityDescriptor, out uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafePipeHandle CreateNamedPipe(string name, uint openMode, uint pipeMode, uint maxInstances, uint outBufferSize, uint inBufferSize, uint defaultTimeout, ref SecurityAttributes securityAttributes);
    [DllImport("kernel32.dll")]
    private static extern nint LocalFree(nint memory);
}
