namespace MeetingLens.Camera;

// One fixed latest frame. Each pipe client owns its own fixed snapshot buffer.
// No recording, unbounded queue, image files, or capture data in diagnostics.
internal sealed class FrameStore
{
    private readonly object gate = new();
    private readonly byte[] latest = new byte[FrameProtocol.PayloadBytes];
    private ulong sequence;
    private long captured;
    private bool live;

    public void PublishRgba(ReadOnlySpan<byte> rgba, ulong frameSequence, long captureTickMilliseconds)
    {
        if (rgba.Length != FrameProtocol.PayloadBytes || frameSequence == 0 || captureTickMilliseconds < 0)
            throw new ArgumentException("Invalid fixed-size RGBA frame.");
        lock (gate)
        {
            for (var offset = 0; offset < latest.Length; offset += 4)
            {
                latest[offset] = rgba[offset + 2];
                latest[offset + 1] = rgba[offset + 1];
                latest[offset + 2] = rgba[offset];
                latest[offset + 3] = 255;
            }
            sequence = frameSequence;
            captured = captureTickMilliseconds;
            live = true;
        }
    }

    public void Black()
    {
        lock (gate)
        {
            live = false;
            sequence = 0;
            captured = 0;
            Array.Clear(latest);
        }
    }

    public (ulong Sequence, long Captured) CopyTo(Span<byte> destination, long now)
    {
        if (destination.Length != FrameProtocol.PayloadBytes) throw new ArgumentException("Invalid frame snapshot size.", nameof(destination));
        lock (gate)
        {
            if (!live || !FrameProtocol.IsFresh(captured, now))
            {
                destination.Clear();
                return (0, now);
            }
            latest.CopyTo(destination);
            return (sequence, captured);
        }
    }
}
