import { fileURLToPath } from "node:url";
const client = fileURLToPath(new URL("../src/Techmap.Client/", import.meta.url));
export default { root: fileURLToPath(new URL("./", import.meta.url)), resolve: { alias: { react: `${client}node_modules/react`, "react-dom": `${client}node_modules/react-dom` } }, optimizeDeps: { include: ["react", "react/jsx-dev-runtime", "react-dom", "react-dom/client"] }, server: { host: "127.0.0.1", port: 5184, strictPort: true, fs: { allow: [client, fileURLToPath(new URL("./", import.meta.url))] } } };
