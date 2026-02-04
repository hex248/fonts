import { readdir } from "node:fs/promises";
import { join, parse } from "node:path";
import { type Context, Hono } from "hono";
import { serveStatic } from "hono/bun";

const app = new Hono();

app.options("*", (c) =>
	c.text("", 204, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
	}),
);

app.use("*", async (c, next) => {
	await next();
	c.header("Access-Control-Allow-Origin", "*");
	c.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
	c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
});

const cssDir = "css";
const templatePath = join("public", "index.html");
const cardPlaceholder = "<!-- FONT_CARDS -->";
const importPlaceholder = "/* FONT_IMPORT */";
const fontCacheControl = "public, max-age=31536000, immutable";
const indexCacheControl = "public, max-age=300, stale-while-revalidate=60";
const cssCacheControl = "public, max-age=86400, stale-while-revalidate=600";

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const escapeAttr = (value: string) => escapeHtml(value);

const normalizeFamily = (value: string) =>
	value.replace(/^['"]|['"]$/g, "").trim();

const slugify = (value: string) =>
	value.toLowerCase().replace(/\s+/g, " ").trim();

const parseWeightValues = (value: string) => {
	const weights: number[] = [];
	const numbers = value.match(/\d+/g)?.map((entry) => Number(entry)) ?? [];
	if (numbers.length === 1) {
		weights.push(numbers[0]);
		return { weights };
	}
	if (numbers.length >= 2) {
		const min = Math.min(numbers[0], numbers[1]);
		const max = Math.max(numbers[0], numbers[1]);
		return { weights, range: { min, max } };
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "bold") {
		weights.push(700);
	} else if (normalized === "normal") {
		weights.push(400);
	}
	return { weights };
};

const parseFontData = (css: string) => {
	const families = new Set<string>();
	const weightsByFamily = new Map<string, Set<number>>();
	const rangesByFamily = new Map<string, { min: number; max: number }>();
	const blocks = css.match(/@font-face\s*{[^}]*}/gms) ?? [];
	for (const block of blocks) {
		const familyMatch = block.match(/font-family\s*:\s*([^;]+);/i);
		if (!familyMatch) {
			continue;
		}
		const family = normalizeFamily(familyMatch[1]);
		if (!family) {
			continue;
		}
		families.add(family);
		const weightMatch = block.match(/font-weight\s*:\s*([^;]+);/i);
		if (!weightMatch) {
			continue;
		}
		const parsed = parseWeightValues(weightMatch[1]);
		const weightSet = weightsByFamily.get(family) ?? new Set<number>();
		for (const weight of parsed.weights) {
			if (Number.isFinite(weight)) {
				weightSet.add(weight);
			}
		}
		if (parsed.range) {
			const existingRange = rangesByFamily.get(family);
			const min = existingRange
				? Math.min(existingRange.min, parsed.range.min)
				: parsed.range.min;
			const max = existingRange
				? Math.max(existingRange.max, parsed.range.max)
				: parsed.range.max;
			rangesByFamily.set(family, { min, max });
		}
		if (weightSet.size > 0) {
			weightsByFamily.set(family, weightSet);
		}
	}
	return {
		families: [...families],
		weightsByFamily,
		rangesByFamily,
	};
};

const addFontDisplaySwap = (css: string) =>
	css.replace(/@font-face\s*{[^}]*}/gms, (block) => {
		if (/font-display\s*:/i.test(block)) {
			return block;
		}
		return block.replace(/}\s*$/, "\n\tfont-display: swap;\n}");
	});

const buildFontCatalog = async () => {
	const entries = await readdir(cssDir, { withFileTypes: true });
	const cssFiles = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	const cards: string[] = [];
	const importUrls: string[] = [];
	let cardIndex = 0;

	for (const fileName of cssFiles) {
		const baseName = parse(fileName).name;
		const route = `/${baseName}`;
		const filePath = join(cssDir, fileName);
		const css = await Bun.file(filePath).text();
		const { families, weightsByFamily, rangesByFamily } = parseFontData(css);

		if (families.length === 0) {
			continue;
		}

		importUrls.push(route);

		for (const family of families) {
			cardIndex += 1;
			const displayName = family || baseName;
			const dataName = slugify(displayName);
			const fontFamily = family || displayName;
			const weightList = [...(weightsByFamily.get(family) ?? [])]
				.filter((weight) => Number.isFinite(weight))
				.sort((a, b) => a - b);
			const weightRange = rangesByFamily.get(family);
			const weights = weightList.length > 0 ? weightList : [400];
			const isSingleWeight = !weightRange && weights.length <= 1;
			const defaultWeight = weightRange
				? Math.round((weightRange.min + weightRange.max) / 2)
				: weights[Math.floor((weights.length - 1) / 2)];
			const weightType = weightRange ? "variable" : "static";
			const card = `\n        <article class="font-card" data-font-card data-font-name="${escapeAttr(
				dataName,
			)}" data-import-url="${escapeAttr(route)}" data-weights="${escapeAttr(
				weights.join(","),
			)}" data-default-weight="${escapeAttr(
				String(defaultWeight),
			)}" data-weight-type="${escapeAttr(weightType)}" data-weight-min="${escapeAttr(
				String(weightRange?.min ?? ""),
			)}" data-weight-max="${escapeAttr(
				String(weightRange?.max ?? ""),
			)}" data-weight-step="10">\n          <div class="font-card__header">\n            <h2 class="font-card__title">${escapeHtml(
				displayName,
			)}</h2>${
				isSingleWeight
					? ""
					: `\n            <div class="font-card__controls">\n              <label class="font-card__label" for="weight-${escapeAttr(
							dataName,
						)}-${cardIndex}">WEIGHT</label>\n              ${
							weightRange
								? `<input class="font-card__range" data-weight-range type="range" id="weight-${escapeAttr(
										dataName,
									)}-${cardIndex}" min="${escapeAttr(String(weightRange.min))}" max="${escapeAttr(String(weightRange.max))}" step="10" />\n              <span class="font-card__value" data-weight-value></span>`
								: `<select class="font-card__select" data-weight-select id="weight-${escapeAttr(
										dataName,
									)}-${cardIndex}"></select>`
						}\n            </div>`
			}\n          </div>\n\n          <div class="font-card__demo">\n            <p class="font-card__demo-primary" data-demo style="font-family: '${escapeAttr(
				fontFamily,
			)}', serif; font-weight: ${escapeAttr(String(defaultWeight))};">\n              The quick brown fox jumps over the lazy dog.\n            </p>\n          </div>\n\n          <div class="font-card__footer">\n           \n            <div class="font-card__snippet">\n              <code class="font-card__code" data-import></code>\n              <button type="button" data-copy class="font-card__copy">\n                COPY\n              </button>\n            </div>\n          </div>\n        </article>`;
			cards.push(card);
		}
	}

	const importCss = '@import url("/all");';

	return {
		cards: cards.join("\n"),
		importCss,
	};
};

const templateHtml = await Bun.file(templatePath).text();
const { cards, importCss } = await buildFontCatalog();
const indexHtml = templateHtml
	.replace(cardPlaceholder, cards)
	.replace(importPlaceholder, importCss);

app.get("/", (c) =>
	c.html(indexHtml, 200, {
		"Cache-Control": indexCacheControl,
	}),
);

const serveFontFile = async (c: Context) => {
	const fontPath = c.req.path.replace(/^\/+/, "");
	if (!fontPath.startsWith("fonts/") || fontPath.includes("..")) {
		return c.notFound();
	}

	const file = Bun.file(fontPath);
	if (!(await file.exists())) {
		return c.notFound();
	}

	const headers = new Headers({
		"Content-Type": file.type || "application/octet-stream",
		"Content-Length": String(file.size),
		"Cache-Control": fontCacheControl,
		"Accept-Ranges": "bytes",
	});

	if (c.req.method === "HEAD") {
		return new Response(null, { status: 200, headers });
	}

	return new Response(file, { status: 200, headers });
};

app.get("/fonts/*", serveFontFile);
app.on("HEAD", "/fonts/*", serveFontFile);
app.use("/*", serveStatic({ root: "./public" }));

const cssRoutes = async () => {
	const entries = await readdir(cssDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".css")) {
			continue;
		}

		const route = `/${entry.name.replace(".css", "")}`;
		const filePath = join(cssDir, entry.name);

		app.get(route, async (c) => {
			const css = addFontDisplaySwap(await Bun.file(filePath).text());
			return c.text(css, 200, {
				"Content-Type": "text/css; charset=utf-8",
				"Cache-Control": cssCacheControl,
			});
		});
	}
};

await cssRoutes();

app.get("/all", async (c) => {
	const entries = await readdir(cssDir, { withFileTypes: true });
	const cssFiles = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	const combined = await Promise.all(
		cssFiles.map(async (fileName) => {
			const filePath = join(cssDir, fileName);
			return addFontDisplaySwap(await Bun.file(filePath).text());
		}),
	);

	return c.text(combined.join("\n"), 200, {
		"Content-Type": "text/css; charset=utf-8",
		"Cache-Control": cssCacheControl,
	});
});

const port = Number(Bun.env.PORT ?? 1553);

export default {
	fetch: app.fetch,
	port,
	hostname: "0.0.0.0",
};
