import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { missingBrowserFeatures } from "./browser-support";
import { loadLocalSession } from "./local-session";
import { RuntimeConfigError, buildRuntimeConfigUrl, loadRuntimeConfig } from "./runtime-config";
import "./styles.css";

function renderStartupError(title: string, details: string): void {
  const root = document.getElementById("root");
  if (!root) return;

  const panel = document.createElement("main");
  panel.className = "startup-error";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const message = document.createElement("p");
  message.textContent = details;
  const hint = document.createElement("p");
  hint.className = "startup-error-hint";
  hint.textContent = "Если ошибка повторяется, перезапустите TECHMAP-GRAPHER и сообщите текст этой страницы ответственному специалисту.";
  panel.append(heading, message, hint);
  root.replaceChildren(panel);
}

async function bootstrap(): Promise<void> {
  try {
    const missing = missingBrowserFeatures();
    if (missing.length > 0) {
      renderStartupError(
        "Браузер не поддерживается",
        `Необходимые возможности отсутствуют: ${missing.join(", ")}. Откройте приложение в актуальной версии Microsoft Edge или Google Chrome.`,
      );
    } else {
      const runtimeConfigUrl = buildRuntimeConfigUrl(import.meta.url);
      const config = await loadRuntimeConfig(
        runtimeConfigUrl,
        async (url) => fetch(url, { cache: "no-store", credentials: "same-origin" }),
      );
      const session = await loadLocalSession(
        config,
        async (input, init) => fetch(input, init),
      );
      const root = document.getElementById("root");
      if (!root) throw new Error("Отсутствует корневой элемент приложения.");
      createRoot(root).render(
        <StrictMode>
          <App config={config} session={session} />
        </StrictMode>,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка запуска.";
    const title = error instanceof RuntimeConfigError
      ? "Не удалось загрузить конфигурацию"
      : "Не удалось запустить приложение";
    renderStartupError(title, message);
  }
}

void bootstrap();
