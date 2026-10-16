using System.Buffers.Binary;
using System.Text.Json;

namespace MeetingLens.Windows;

// These tests cover the wire protocol, not hardware availability or AI image quality.
internal static class ProtocolTests
{
    internal static int Run()
    {
        var checks = new List<string>();
        void Check(bool condition, string label)
        {
            if (!condition) throw new InvalidOperationException(label);
            checks.Add(label);
        }
        try
        {
            var effect = KsControl.Effects[0];
            var prop = KsControl.Property(effect, 1);
            Check(prop.Length == 24 && new Guid(prop.AsSpan(0, 16)) == KsControl.Extended, "KSPROPERTY GUID layout");
            Check(BinaryPrimitives.ReadUInt32LittleEndian(prop.AsSpan(16)) == 41, "Background property id");
            Check(BinaryPrimitives.ReadUInt32LittleEndian(prop.AsSpan(20)) == 1, "GET property flag");
            var payload = KsControl.Payload(5);
            Check(payload.Length == 40 && BinaryPrimitives.ReadUInt32LittleEndian(payload.AsSpan(4)) == uint.MaxValue,
                "Extended payload filter scope");
            BinaryPrimitives.WriteUInt64LittleEndian(payload.AsSpan(24), 7);
            var read = KsControl.Parse(payload);
            Check(read.Flags == 5 && read.Capabilities == 7, "Extended header parse");
            Check(KsControl.Modes(effect, 1).SequenceEqual(new[] { "Off", "Standard blur" }), "Unsupported mode excluded");
            Check(KsControl.Modes(effect, 5).Contains("Portrait blur"), "Combined flags supported");
            var rejected = false;
            try { KsControl.Parse([0, 1, 2]); } catch (InvalidDataException) { rejected = true; }
            Check(rejected, "Truncated response rejected");
            BinaryPrimitives.WriteUInt32LittleEndian(payload.AsSpan(8), 100);
            rejected = false;
            try { KsControl.Parse(payload); } catch (InvalidDataException) { rejected = true; }
            Check(rejected, "Oversized response rejected");
            BinaryPrimitives.WriteUInt32LittleEndian(payload.AsSpan(8), 40);
            BinaryPrimitives.WriteUInt32LittleEndian(payload.AsSpan(12), 1);
            rejected = false;
            try { KsControl.Parse(payload); } catch (InvalidDataException) { rejected = true; }
            Check(rejected, "Driver failure rejected");
            var state = new EffectState("test", "Test", true, 1UL << 63, ulong.MaxValue, ["Off"], null);
            using var report = JsonDocument.Parse(JsonSerializer.Serialize(state,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
            Check(report.RootElement.GetProperty("flags").GetString() == "9223372036854775808" &&
                  report.RootElement.GetProperty("capabilities").GetString() == "18446744073709551615",
                "64-bit report flags retain exact decimal values");
            using var unavailable = JsonDocument.Parse(JsonSerializer.Serialize(state with { Flags = null, Capabilities = null },
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
            Check(unavailable.RootElement.GetProperty("flags").ValueKind == JsonValueKind.Null &&
                  unavailable.RootElement.GetProperty("capabilities").ValueKind == JsonValueKind.Null,
                "Unavailable report flags remain null");
            File.WriteAllText("native-self-test.json", JsonSerializer.Serialize(new { passed = true, checks = checks.Count, results = checks }));
            return 0;
        }
        catch (Exception error)
        {
            File.WriteAllText("native-self-test.json", JsonSerializer.Serialize(new { passed = false, checks = checks.Count, error = error.Message }));
            return 1;
        }
    }
}
