using System.Text.Json;

namespace MeetingLens.Camera;

internal readonly record struct BrowserMessage(string Type, ulong Sequence, string State);

internal static class MessageContract
{
    public const string Origin = "https://appassets.meetinglens.example";
    public const int MaximumMessageCharacters = 2048;

    public static bool IsTrustedDocument(string source)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)) return false;
        return IsTrustedOrigin(source) && uri.AbsolutePath == "/index.html";
    }

    public static bool IsTrustedOrigin(string source) => Uri.TryCreate(source, UriKind.Absolute, out var uri) &&
        uri.Scheme == "https" && uri.Host == "appassets.meetinglens.example" && uri.IsDefaultPort && uri.UserInfo.Length == 0;

    public static bool IsLocalPage(string source) => IsTrustedOrigin(source) && Uri.TryCreate(source, UriKind.Absolute, out var uri) &&
        uri.AbsolutePath is "/index.html" or "/photo-workbench.html" or "/privacy.html" or "/terms.html" or "/offline.html" or "/native-capabilities.html";

    public static bool TryParse(string json, string expectedSession, out BrowserMessage message)
    {
        message = default;
        if (json.Length > MaximumMessageCharacters || expectedSession.Length == 0) return false;
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 4 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("protocol", out var protocol) ||
                protocol.ValueKind != JsonValueKind.Number || !protocol.TryGetInt32(out var protocolVersion) || protocolVersion != 1 ||
                !root.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String ||
                session.GetString() != expectedSession || !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String)
                return false;
            switch (type.GetString())
            {
                case "meetinglens.native.frame":
                    if (!root.TryGetProperty("width", out var width) || width.ValueKind != JsonValueKind.Number || !width.TryGetInt32(out var frameWidth) || frameWidth != FrameProtocol.Width ||
                        !root.TryGetProperty("height", out var height) || height.ValueKind != JsonValueKind.Number || !height.TryGetInt32(out var frameHeight) || frameHeight != FrameProtocol.Height ||
                        !root.TryGetProperty("sequence", out var sequence) || sequence.ValueKind != JsonValueKind.Number || !sequence.TryGetUInt64(out var number) || number == 0 || number > int.MaxValue)
                        return false;
                    message = new BrowserMessage("frame", number, "");
                    return true;
                case "meetinglens.native.state":
                    if (!root.TryGetProperty("state", out var state) || state.ValueKind != JsonValueKind.String) return false;
                    var status = state.GetString();
                    if (status is not ("live" or "stopped" or "blocked" or "privacy")) return false;
                    message = new BrowserMessage("state", 0, status);
                    return true;
                default: return false;
            }
        }
        catch (JsonException) { return false; }
    }
}
