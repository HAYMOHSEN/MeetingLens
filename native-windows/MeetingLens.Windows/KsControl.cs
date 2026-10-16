// KS property layouts adapted from Microsoft's MIT-licensed Windows-Camera sample.
// Provenance and license: ../THIRD_PARTY_NOTICES.md and ../vendor/MICROSOFT-LICENSE.txt.
using System.Buffers.Binary;
using Windows.Media.Devices;

namespace MeetingLens.Windows;

internal sealed record EffectDefinition(string Id, string Label, Guid PropertySet, uint PropertyId,
    IReadOnlyDictionary<string, ulong> Modes);

internal sealed record EffectState(string Id, string Label, bool Supported, ulong? Flags,
    ulong? Capabilities, string[] Modes, string? Error);

internal static class KsControl
{
    internal static readonly Guid Extended = new("1CB79112-C0D2-4213-9CA6-CD4FDB927972");
    internal static readonly Guid Studio = new("1666D655-21A6-4982-9728-52C39E869F90");
    internal const int HeaderSize = 32;
    internal const int PayloadSize = 40;

    internal static readonly EffectDefinition[] Effects =
    [
        new("backgroundBlur", "Background blur", Extended, 41,
            new Dictionary<string, ulong> { ["Off"] = 0, ["Standard blur"] = 1, ["Portrait blur"] = 5 }),
        new("eyeContact", "Eye contact", Extended, 40,
            new Dictionary<string, ulong> { ["Off"] = 0, ["Standard"] = 1, ["Teleprompter"] = 3 }),
        new("portraitLight", "Portrait light", Studio, 1,
            new Dictionary<string, ulong> { ["Off"] = 0, ["On"] = 1 })
    ];

    // KSPROPERTY: GUID (16), Id (4), Flags (4). GUID.ToByteArray matches native memory order.
    internal static byte[] Property(EffectDefinition effect, uint flags)
    {
        var bytes = new byte[24];
        effect.PropertySet.TryWriteBytes(bytes);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(16), effect.PropertyId);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(20), flags);
        return bytes;
    }

    // KSCAMERA_EXTENDEDPROP_HEADER + KSCAMERA_EXTENDEDPROP_VALUE.
    internal static byte[] Payload(ulong flags)
    {
        var bytes = new byte[PayloadSize];
        BinaryPrimitives.WriteUInt32LittleEndian(bytes, 1); // Version
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), uint.MaxValue); // FILTERSCOPE
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(8), PayloadSize);
        BinaryPrimitives.WriteUInt64LittleEndian(bytes.AsSpan(16), flags);
        return bytes;
    }

    internal static (ulong Flags, ulong Capabilities) Parse(byte[] bytes)
    {
        if (bytes.Length < HeaderSize) throw new InvalidDataException("The camera returned a truncated KS header.");
        var version = BinaryPrimitives.ReadUInt32LittleEndian(bytes);
        var length = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(8));
        var result = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(12));
        if (version != 1 || length < HeaderSize || length > bytes.Length || result != 0)
            throw new InvalidDataException($"Invalid KS response (version {version}, bytes {length}, result {result}).");
        return (BinaryPrimitives.ReadUInt64LittleEndian(bytes.AsSpan(16)),
            BinaryPrimitives.ReadUInt64LittleEndian(bytes.AsSpan(24)));
    }

    internal static string[] Modes(EffectDefinition effect, ulong capabilities) =>
        effect.Modes.Where(mode => (mode.Value & capabilities) == mode.Value).Select(mode => mode.Key).ToArray();

    internal static EffectState Read(VideoDeviceController controller, EffectDefinition effect)
    {
        try
        {
            var response = controller.GetDevicePropertyByExtendedId(Property(effect, 1), null);
            if (response.Status != VideoDeviceControllerGetDevicePropertyStatus.Success)
                return new(effect.Id, effect.Label, false, null, null, [], response.Status.ToString());
            if (response.Value is not byte[] bytes)
                return new(effect.Id, effect.Label, false, null, null, [], "The camera did not return a byte payload.");
            var header = Parse(bytes);
            return new(effect.Id, effect.Label, true, header.Flags, header.Capabilities,
                Modes(effect, header.Capabilities), null);
        }
        catch (Exception error)
        {
            return new(effect.Id, effect.Label, false, null, null, [], error.Message);
        }
    }

    internal static void Write(VideoDeviceController controller, EffectDefinition effect, ulong flags, bool restore = false)
    {
        // Read immediately before writing: another app or camera mode may have changed support.
        var state = Read(controller, effect);
        if (!state.Supported || state.Capabilities is not ulong capabilities ||
            (flags & capabilities) != flags || (!restore && !effect.Modes.Values.Contains(flags)))
            throw new NotSupportedException($"{effect.Label}: that mode is not advertised by this camera.");
        var result = controller.SetDevicePropertyByExtendedId(Property(effect, 2), Payload(flags));
        if (result != VideoDeviceControllerSetDevicePropertyStatus.Success)
            throw new InvalidOperationException($"{effect.Label}: the camera rejected the change ({result}).");
        var actual = Read(controller, effect);
        if (!actual.Supported || actual.Flags != flags)
            throw new InvalidOperationException($"{effect.Label}: the camera did not confirm the requested state.");
    }
}
