import { readFile, readdir, stat } from "node:fs/promises";
import { join, parse } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/serve-static";

const app = new Hono();

const cssDir = "css";
const templatePath = join("public", "index.html");
const cardPlaceholder = "<!-- FONT_CARDS -->";
const importPlaceholder = "/* FONT_IMPORT */";

const serveStaticFromFs = (options: { root: string }) =>
	serveStatic({
		root: options.root,
		getContent: async (path) => {
			try {
				return await readFile(path);
			} catch (error) {
				return null;
			}
		},
		isDir: async (path) => {
			try {
				const stats = await stat(path);
				return stats.isDirectory();
			} catch (error) {
				return undefined;
			}
		},
		join,
	});

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const escapeAttr = (value: string) => escapeHtml(value);

const normalizeFamily = (value: string) => value.replace(/^['"]|['"]$/g, "").trim();

const slugify = (value: string) =>
	value
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();

const parseFontFamilies = (css: string) => {
	const families = new Set<string>();
	const blocks = css.match(/@font-face\s*{[^}]*}/gms) ?? [];
	for (const block of blocks) {
		const match = block.match(/font-family\s*:\s*([^;]+);/i);
		if (!match) {
			continue;
		}
		const family = normalizeFamily(match[1]);
		if (family) {
			families.add(family);
		}
	}
	return [...families];
};

const buildFontCatalog = async () => {
	const entries = await readdir(cssDir, { withFileTypes: true });
	const cssFiles = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	const cards: string[] = [];
	const importUrls: string[] = [];

	for (const fileName of cssFiles) {
		const baseName = parse(fileName).name;
		const route = `/${baseName}`;
		const filePath = join(cssDir, fileName);
		const css = await readFile(filePath, "utf8");
		const families = parseFontFamilies(css);

		if (families.length === 0) {
			continue;
		}

		importUrls.push(route);

		for (const family of families) {
			const displayName = family || baseName;
			const dataName = slugify(displayName);
			const fontFamily = family || displayName;
			const card = `\n        <article class="font-card" data-font-card data-font-name="${escapeAttr(
				dataName,
			)}" data-import-url="${escapeAttr(route)}">\n          <div class="font-card__header">\n            <h2 class="font-card__title">${escapeHtml(
				displayName,
			)}</h2>\n          </div>\n\n          <div class="font-card__demo">\n            <p class="font-card__demo-primary" style="font-family: '${escapeAttr(
				fontFamily,
			)}', serif;">\n              The quick brown fox jumps over the lazy dog.\n            </p>\n          </div>\n\n          <div class="font-card__footer">\n            <p class="font-card__label">IMPORT SNIPPET</p>\n            <div class="font-card__snippet">\n              <code class="font-card__code" data-import></code>\n              <button type="button" data-copy class="font-card__copy">\n                COPY\n              </button>\n            </div>\n          </div>\n        </article>`;
			cards.push(card);
		}
	}

	const importCss = importUrls
		.map((url) => `@import url(\"${url}\");`)
		.join("\n");

	return {
		cards: cards.join("\n"),
		importCss,
	};
};

const templateHtml = await readFile(templatePath, "utf8");
const { cards, importCss } = await buildFontCatalog();
const indexHtml = templateHtml
	.replace(cardPlaceholder, cards)
	.replace(importPlaceholder, importCss);

app.get("/", (c) => c.html(indexHtml));

app.use("/fonts/*", serveStaticFromFs({ root: "." }));
app.use("/*", serveStaticFromFs({ root: "./public" }));

const cssRoutes = async () => {
	const entries = await readdir(cssDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".css")) {
			continue;
		}

		const route = `/${entry.name.replace(".css", "")}`;
		const filePath = join(cssDir, entry.name);

		app.get(route, async (c) => {
			const css = await readFile(filePath, "utf8");
			return c.text(css, 200, {
				"Content-Type": "text/css; charset=utf-8",
			});
		});
	}
};

await cssRoutes();

const port = Number(process.env.PORT ?? 3000);

export default {
	fetch: app.fetch,
	port,
};

export { app };
