import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const app = new Hono();

app.use("/fonts/*", serveStatic({ root: "." }));
app.use("/*", serveStatic({ root: "./public" }));

const cssDir = "css";

const cssRoutes = async () => {
	const entries = await readdir(cssDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".css")) {
			continue;
		}

		const route = `/${entry.name.replace(".css", "")}`;
		const filePath = join(cssDir, entry.name);

		app.get(route, async (c) => {
			const css = await Bun.file(filePath).text();
			return c.text(css, 200, {
				"Content-Type": "text/css; charset=utf-8",
			});
		});
	}
};

await cssRoutes();

const port = Number(Bun.env.PORT ?? 3000);

export default {
	fetch: app.fetch,
	port,
};
