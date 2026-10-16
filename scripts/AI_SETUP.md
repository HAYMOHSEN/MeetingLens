# Optional image-editing bridge

Offline drawing, vectors, animation, natural-media controls and local Assist tools do not require this setup or any paid account.

## Local setup

1. Use Node.js 22 or newer. No npm dependencies are needed to run the bridge.
2. Set `OPENAI_API_KEY` in the server process environment. Do not paste that key into the app, put it in browser storage, or commit it to a project.
3. Run `node ai-bridge.cjs` from this folder.
4. Open `http://127.0.0.1:8787`. Use this exact address rather than `localhost`; the bridge checks the browser origin.
5. Copy the separate **bridge session token** printed by the server into Assist. Leave the endpoint at `http://127.0.0.1:8787/api/image-edit`.
6. Select the paint layer that should be sent. For fill, make a selection and enter a prompt. Read and check the upload-consent box, then choose **Run connected AI**. Review before applying.

For a Windows PowerShell session, you can enter a key without putting its literal value in command history:

```powershell
$rasmoraKey = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $rasmoraKey).Password
node .\ai-bridge.cjs
# After stopping the server with Ctrl+C:
Remove-Item Env:OPENAI_API_KEY
Remove-Variable rasmoraKey
```

Treat the terminal's session token as private too. Restarting the bridge generates a new token unless you explicitly set `RASMORA_BRIDGE_TOKEN`. The browser token field is not saved in projects.

## Configuration

| Environment variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for provider requests; retained only on the server. |
| `RASMORA_PORT` | Local server port, default `8787`. |
| `RASMORA_BRIDGE_TOKEN` | Optional separate 24–256-character token; otherwise generated for the session. Never use a provider key here. |
| `RASMORA_ALLOWED_ORIGIN` | Exact trusted browser origin; default `http://127.0.0.1:8787`, or the configured port. No trailing slash or wildcard. |
| `RASMORA_IMAGE_MODEL` | Server-selected model, default `gpt-image-2.5-sunburst`. Choose a model supporting the requested sizes and transparency. |

The bridge binds to `127.0.0.1`, serves only whitelisted app assets, accepts authenticated requests from the configured origin, limits request/result sizes, rejects arbitrary upstream URLs, permits one active job, and uses a request timeout. It does not log image contents or prompts. Images are forwarded to the provider when requested; provider terms and retention policies apply.

This is a single-user localhost bridge, not a production multi-user service. Public deployment requires separately designed authentication, authorization, quotas, logging/retention policy and TLS. No deployment, account setup, charges or live AI calls were performed for this delivery.

## Operations and review

- **Background removal:** asks the provider to return a transparent-background PNG while preserving the subject. Generative removal may alter details; inspect edges, faces and text.
- **Prompt fill:** sends the active layer plus an inverse-alpha edit mask. Models may change content beyond the mask, so Rasmora additionally clips the result to the frozen selection when **Apply as new layer** is chosen. Downloading the raw result exports the full returned image.
- **Enhancement:** requests 2048 × 1536 output. This may add plausible detail, not recover factual detail. The full PNG is downloadable; adding it as a layer fits the 1200 × 900 document.
- **Cancellation:** stops waiting and aborts the bridge request when possible. The provider may already have processed or billed it.

If AI fails, the source layer remains unchanged. A failed or rejected response must not be treated as a completed edit. Local tools continue to work without provider access.

Implementation references checked 16 October 2026:

- [OpenAI Images Edit API](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [OpenAI image-generation guide, masks and limitations](https://developers.openai.com/api/docs/guides/image-generation)
- [MDN canvas captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
- [MDN MediaRecorder format detection](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)
