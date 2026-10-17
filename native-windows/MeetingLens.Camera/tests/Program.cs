using System.Buffers.Binary;
using System.Text.Json;
using MeetingLens.Camera;

var checks = new List<string>();
void Check(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException(name);
    checks.Add(name);
}

var bytes = new byte[FrameProtocol.HeaderBytes];
FrameProtocol.WriteHeader(bytes, 0x1122334455667788, 987654321);
Check(BinaryPrimitives.ReadUInt32LittleEndian(bytes) == 0x31464c4d, "MLF1 little-endian magic");
Check(BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(4)) == 1 && BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(6)) == 40, "Protocol version and exact header length");
Check(BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(8)) == 1280 && BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(12)) == 720, "Fixed dimensions");
Check(BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(16)) == 5120 && BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(20)) == 3686400, "Exact stride and payload");
Check(BinaryPrimitives.ReadUInt64LittleEndian(bytes.AsSpan(24)) == 0x1122334455667788 && BinaryPrimitives.ReadUInt64LittleEndian(bytes.AsSpan(32)) == 987654321, "Sequence and same-boot capture timestamp");
Check(FrameProtocol.IsFresh(1000, 1749) && !FrameProtocol.IsFresh(1000, 1750) && !FrameProtocol.IsFresh(1000, 999), "750ms expiration and future timestamp rejection");

var store = new FrameStore();
var rgba = new byte[FrameProtocol.PayloadBytes];
var bgra = new byte[FrameProtocol.PayloadBytes];
rgba[0] = 19; rgba[1] = 52; rgba[2] = 87; rgba[3] = 0;
rgba[^4] = 201; rgba[^3] = 102; rgba[^2] = 3;
Check(store.CopyTo(bgra, 1000).Sequence == 0 && bgra.All(value => value == 0), "New session starts black");
store.PublishRgba(rgba, 17, 1000);
Check(store.CopyTo(bgra, 1749) == (17UL, 1000L), "Fresh frame keeps capture timestamp");
Check(bgra[0] == 87 && bgra[1] == 52 && bgra[2] == 19 && bgra[3] == 255 && bgra[^4] == 3 && bgra[^2] == 201 && bgra[^1] == 255, "RGBA to top-down opaque BGRA conversion reaches last pixel");
Check(store.CopyTo(bgra, 1750).Sequence == 0 && bgra.All(value => value == 0), "Stale frame clears all pixels");
store.PublishRgba(rgba, 18, 2000); store.Black();
Check(store.CopyTo(bgra, 2001).Sequence == 0 && bgra.All(value => value == 0), "Privacy and stop immediately clear latest frame");

const string token = "0123456789abcdef0123456789abcdef";
string Frame(object protocol, object width, object height, object sequence, string session = token) => JsonSerializer.Serialize(new
{ type = "meetinglens.native.frame", protocol, sessionId = session, width, height, sequence });
Check(MessageContract.TryParse(Frame(1, 1280, 720, 33), token, out var valid) && valid.Sequence == 33, "Valid frame metadata accepted");
Check(!MessageContract.TryParse(Frame(1, 1280, 720, 33, "other-session"), token, out _), "Prior and foreign sessions rejected");
Check(!MessageContract.TryParse(Frame("1", 1280, 720, 33), token, out _) &&
      !MessageContract.TryParse(Frame(1, new[] { 1280 }, 720, 33), token, out _) &&
      !MessageContract.TryParse(Frame(1, 1280, new { value = 720 }, 33), token, out _) &&
      !MessageContract.TryParse(Frame(1, 1280, 720, "33"), token, out _), "Wrong JSON scalar types cannot throw");
Check(!MessageContract.TryParse(Frame(1, 1280.5, 720, 33), token, out _) && !MessageContract.TryParse(Frame(1, 1280, 720, 0), token, out _) &&
      !MessageContract.TryParse(Frame(1, 1280, 720, -1), token, out _) && !MessageContract.TryParse(Frame(1, 1280, 720, (long)int.MaxValue + 1), token, out _), "Fractional, zero, negative and overflow values rejected");
Check(!MessageContract.TryParse("{bad", token, out _) && !MessageContract.TryParse("[]", token, out _) &&
      !MessageContract.TryParse(new string(' ', 2049), token, out _), "Malformed and oversized messages rejected");
foreach (var state in new[] { "live", "privacy", "blocked", "stopped" })
    Check(MessageContract.TryParse(JsonSerializer.Serialize(new { type = "meetinglens.native.state", protocol = 1, sessionId = token, state }), token, out var result) && result.State == state, "Allowed state " + state);
Check(MessageContract.IsTrustedDocument(MessageContract.Origin + "/index.html") && !MessageContract.IsTrustedDocument("https://appassets.meetinglens.example.evil.test/index.html") &&
      !MessageContract.IsTrustedDocument("http://appassets.meetinglens.example/index.html") && !MessageContract.IsTrustedDocument("https://appassets.meetinglens.example:444/index.html") &&
      !MessageContract.IsTrustedDocument(MessageContract.Origin + "/privacy.html"), "Exact secure origin and document required");
Check(MessageContract.IsTrustedOrigin(MessageContract.Origin + "/") && !MessageContract.IsTrustedOrigin("https://appassets.meetinglens.example.evil.test/"), "Permission origins accepted only for bundled app");
Check(MessageContract.IsLocalPage(MessageContract.Origin + "/photo-workbench.html") && MessageContract.IsLocalPage(MessageContract.Origin + "/privacy.html") &&
      !MessageContract.IsLocalPage(MessageContract.Origin + "/unknown.html"), "Only bundled top-level pages may navigate");
Console.WriteLine(JsonSerializer.Serialize(new { passed = true, checks = checks.Count, tests = checks }));
