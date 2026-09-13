namespace Techmap.Web;

public static class BrowserLifecycleScript
{
    public const string FileName = "techmap-browser-lifecycle.js";

    public const string Content = """
        (() => {
          const sessionUrl = new URL('api/v1/session', document.baseURI);
          const lifecycleUrl = new URL('api/v1/browser-lifecycle', document.baseURI);
          let active = true;
          let controller;

          const connect = async () => {
            if (!active || controller) return;
            const current = new AbortController();
            controller = current;
            try {
              const sessionResponse = await fetch(sessionUrl, {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: current.signal
              });
              if (!sessionResponse.ok) return;
              const session = await sessionResponse.json();
              const response = await fetch(lifecycleUrl, {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Techmap-CSRF': session.csrfNonce
                },
                body: '{}',
                signal: current.signal
              });
              if (!response.ok || !response.body) return;
              const reader = response.body.getReader();
              while (active) {
                const item = await reader.read();
                if (item.done) break;
              }
            } catch (_) {
              // A navigation abort and a transient connection loss are expected here.
            } finally {
              if (controller === current) controller = undefined;
              if (active) window.setTimeout(connect, 1000);
            }
          };
          const disconnect = () => {
            active = false;
            controller?.abort();
            controller = undefined;
          };

          connect();
          window.addEventListener('pagehide', disconnect);
          window.addEventListener('pageshow', event => {
            if (!event.persisted) return;
            active = true;
            connect();
          });
        })();
        """;
}
