using System.Buffers.Binary;

namespace MeetingLens.Camera;

internal static class FrameProtocol
{
    public const int Width = 1280;
    public const int Height = 720;
    public const int Stride = Width * 4;
    public const int PayloadBytes = Stride * Height;
    public const int HeaderBytes = 40;
    public const long StaleMilliseconds = 750;
    public const long RequestDeadlineMilliseconds = 600;
    public const uint Magic = 0x31464c4d;
    public static ReadOnlySpan<byte> Request => "NEXT"u8;
    public static readonly Guid PipeAttribute = new("6BC993A9-DB38-4A03-B644-68B0B7BCE392");
    public static readonly Guid ProviderClsid = new("2EBFD872-C949-48E9-A2C4-87C5B0A5BC92");

    public static void WriteHeader(Span<byte> header, ulong sequence, long captureTickMilliseconds)
    {
        if (header.Length != HeaderBytes) throw new ArgumentException("Frame header must be 40 bytes.", nameof(header));
        BinaryPrimitives.WriteUInt32LittleEndian(header, Magic);
        BinaryPrimitives.WriteUInt16LittleEndian(header[4..], 1);
        BinaryPrimitives.WriteUInt16LittleEndian(header[6..], HeaderBytes);
        BinaryPrimitives.WriteUInt32LittleEndian(header[8..], Width);
        BinaryPrimitives.WriteUInt32LittleEndian(header[12..], Height);
        BinaryPrimitives.WriteUInt32LittleEndian(header[16..], Stride);
        BinaryPrimitives.WriteUInt32LittleEndian(header[20..], PayloadBytes);
        BinaryPrimitives.WriteUInt64LittleEndian(header[24..], sequence);
        BinaryPrimitives.WriteUInt64LittleEndian(header[32..], checked((ulong)captureTickMilliseconds));
    }

    public static bool IsFresh(long captureTickMilliseconds, long now) =>
        captureTickMilliseconds >= 0 && now >= captureTickMilliseconds && now - captureTickMilliseconds < StaleMilliseconds;
}
