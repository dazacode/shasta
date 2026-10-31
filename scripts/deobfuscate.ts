// Deobfuscate the shipped Shasta chunks: `bun run deobfuscate [--in dir] [--out dir] [--only sub]`.
//
// Production builds of the browser run Shasta's own chunks through javascript-obfuscator
// (shasta/vite.config.ts): a rotated string array plus hexadecimal identifier names. This undoes
// exactly that step — offline, with the @babel/* toolchain that already ships in shasta/node_modules —
// so a downloaded bundle is readable again without rebuilding it. Vendor chunks are left alone by the
// build (autoExcludeNodeModules); files with no string array are copied through untouched.
//
// It is lossless: strings are resolved through the real, already-rotated array; nothing is guessed.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
// @babel/* lives in the shasta app's dependencies; resolve it as if we imported from there.
const requireFromShasta = createRequire(join(ROOT, "shasta", "package.json"));
const parser = requireFromShasta("@babel/parser");
const traverse = requireFromShasta("@babel/traverse").default;
const generate = requireFromShasta("@babel/generator").default;
const t = requireFromShasta("@babel/types");

// The obfuscator uses identifierNamesGenerator "hexadecimal": every renamed symbol looks like _0x1f2a.
const OBF_NAME = /^_0x[0-9a-f]{4,}$/;

type AnyNode = any;
type AnyPath = any;

const CONST_OPS: Record<string, (a: number, b: number) => number> = {
	"+": (a, b) => a + b,
	"-": (a, b) => a - b,
	"*": (a, b) => a * b,
	"/": (a, b) => a / b,
	"%": (a, b) => a % b,
	"<<": (a, b) => a << b,
	">>": (a, b) => a >> b,
	">>>": (a, b) => a >>> b,
	"|": (a, b) => a | b,
	"&": (a, b) => a & b,
	"^": (a, b) => a ^ b,
};

// Fold a call argument to a number: literals, negatives, and arithmetic on them.
function constEval(node: AnyNode): number | null {
	if (t.isNumericLiteral(node)) return node.value;
	if (t.isUnaryExpression(node) && node.operator === "-") {
		const arg = constEval(node.argument);
		return arg === null ? null : -arg;
	}
	if (t.isBinaryExpression(node)) {
		const op = CONST_OPS[node.operator];
		if (!op) return null;
		const left = constEval(node.left);
		const right = constEval(node.right);
		if (left === null || right === null) return null;
		return op(left, right);
	}
	return null;
}

function parse(code: string): AnyNode {
	return parser.parse(code, {
		sourceType: "unambiguous",
		errorRecovery: true,
		allowReturnOutsideFunction: true,
		plugins: ["importAttributes", "dynamicImport", "topLevelAwait", "classProperties", "classPrivateProperties", "classPrivateMethods", "optionalChaining", "nullishCoalescingOperator", "logicalAssignment"],
	});
}

// A javascript-obfuscator string-array prologue is three parts: the array factory, the index decoder
// that reads it, and the rotation IIFE that shuffles it before anyone decodes anything.
type Prologue = { decoder: AnyNode; factory: AnyNode; rotate: AnyNode | null; decoderName: string; factoryName: string };

// Find every (decoder, factory, rotate) triple in the file.
function findPrologues(ast: AnyNode): Prologue[] {
	const factories = new Map<string, { node: AnyNode; strings: number }>();
	traverse(ast, {
		FunctionDeclaration(path: AnyPath) {
			const { node } = path;
			if (!node.id || node.params.length) return;
			let strings = 0;
			path.traverse({
				ArrayExpression(p: AnyPath) {
					for (const el of p.node.elements) if (t.isStringLiteral(el)) strings++;
				},
			});
			if (strings < 8) return; // the string array is by far the biggest literal array in the file
			const prev = factories.get(node.id.name);
			if (!prev || prev.strings < strings) factories.set(node.id.name, { node, strings });
		},
	});
	if (!factories.size) return [];

	const prologues: Prologue[] = [];
	for (const [factoryName, { node: factory }] of factories) {
		const decoders: AnyNode[] = [];
		traverse(ast, {
			FunctionDeclaration(path: AnyPath) {
				const { node } = path;
				if (!node.id || !node.params.length || node.params.length > 2) return;
				let callsFactory = false;
				path.traverse({
					CallExpression(p: AnyPath) {
						if (t.isIdentifier(p.node.callee) && p.node.callee.name === factoryName) callsFactory = true;
					},
				});
				if (callsFactory) decoders.push(node);
			},
		});
		let rotate: AnyNode | null = null;
		traverse(ast, {
			ExpressionStatement(path: AnyPath) {
				const expr = path.node.expression;
				if (rotate || !t.isCallExpression(expr) || !t.isFunctionExpression(expr.callee)) return;
				const first = expr.arguments[0];
				if (t.isIdentifier(first) && first.name === factoryName) rotate = path.node;
			},
		});
		for (const decoder of decoders) prologues.push({ decoder, factory, rotate, decoderName: decoder.id.name, factoryName });
	}
	return prologues;
}

// Run the prologue in a sandbox to get the decoder, with its rotation already applied.
function makeDecoder(p: Prologue): ((index: number) => unknown) | null {
	try {
		const parts = [generate(p.decoder).code, generate(p.factory).code];
		if (p.rotate) parts.push(generate(p.rotate).code);
		const fn = new Function(`${parts.join("\n")}\nreturn ${p.decoderName};`) as () => ((i: number) => unknown) | null;
		return fn();
	} catch {
		return null;
	}
}

// Every name that ends up calling the decoder: the decoder itself and any `x = decoder` alias.
function decoderAliases(ast: AnyNode, seed: string): Set<string> {
	const names = new Set([seed]);
	let grew = true;
	while (grew) {
		grew = false;
		traverse(ast, {
			VariableDeclarator(path: AnyPath) {
				const { id, init } = path.node;
				if (t.isIdentifier(id) && t.isIdentifier(init) && names.has(init.name) && !names.has(id.name)) {
					names.add(id.name);
					grew = true;
				}
			},
			AssignmentExpression(path: AnyPath) {
				const { left, right } = path.node;
				if (t.isIdentifier(left) && t.isIdentifier(right) && names.has(right.name) && !names.has(left.name)) {
					names.add(left.name);
					grew = true;
				}
			},
		});
	}
	return names;
}

// Resolve decoder calls, unwrapping a local `const d = decoder` alias as it goes.
function decodeCalls(ast: AnyNode, aliases: Set<string>, decode: (i: number) => unknown): { total: number; done: number } {
	let total = 0;
	let done = 0;
	traverse(ast, {
		CallExpression(path: AnyPath) {
			const { node } = path;
			if (!t.isIdentifier(node.callee) || !aliases.has(node.callee.name) || node.arguments.length < 1) return;
			total++;
			const arg = node.arguments[0];
			if (t.isSpreadElement(arg)) return;
			const index = constEval(arg);
			if (index === null) return;
			const value = decode(index);
			if (typeof value !== "string") return;
			path.replaceWith(t.stringLiteral(value));
			done++;
		},
	});
	return { total, done };
}

// Drop the now-unused alias declarations, the rotation IIFE, and the decoder/factory themselves.
function stripPrologue(ast: AnyNode, decoderNames: Set<string>, factoryName: string): void {
	const referenceCount = () => {
		const counts = new Map<string, number>();
		traverse(ast, {
			Identifier(path: AnyPath) {
				if (path.isReferencedIdentifier()) counts.set(path.node.name, (counts.get(path.node.name) ?? 0) + 1);
			},
		});
		return counts;
	};
	// aliases only become removable in waves (a -> b -> decoder), so sweep a few times
	for (let pass = 0; pass < 4; pass++) {
		const counts = referenceCount();
		const unused = (name: string) => (counts.get(name) ?? 0) === 0;
		traverse(ast, {
			VariableDeclarator(path: AnyPath) {
				const { id, init } = path.node;
				if (t.isIdentifier(id) && t.isIdentifier(init) && decoderNames.has(init.name) && unused(id.name)) path.remove();
			},
			FunctionDeclaration(path: AnyPath) {
				const { id } = path.node;
				if (!id || !(decoderNames.has(id.name) || id.name === factoryName)) return;
				// the array factory reassigns itself on first call, so only references from *outside* it count
				let self = 0;
				path.traverse({
					Identifier(p: AnyPath) {
						if (p.isReferencedIdentifier() && p.node.name === id.name) self++;
					},
				});
				if ((counts.get(id.name) ?? 0) !== self) return;
				path.remove();
			},
			ExpressionStatement(path: AnyPath) {
				const expr = path.node.expression;
				if (!t.isCallExpression(expr) || !t.isFunctionExpression(expr.callee)) return;
				const first = expr.arguments[0];
				if (t.isIdentifier(first) && first.name === factoryName) path.remove();
			},
		});
	}
	traverse(ast, {
		VariableDeclaration(path: AnyPath) {
			if (path.node.elements === undefined && path.node.declarations.length === 0) path.remove();
		},
	});
}

// Pin a prefix no identifier already uses: then a renamed symbol can never collide with, or be
// shadowed by, an existing name, so renaming by name is safe.
function safePrefix(ast: AnyNode): string {
	const used = new Set<string>();
	traverse(ast, {
		Identifier(path: AnyPath) {
			used.add(path.node.name);
		},
	});
	let prefix = "$";
	while ([...used].some((n) => n.startsWith(prefix))) prefix += "$";
	return prefix;
}

// import/export edges keep their names (the build sets ignoreImports), so only the local half may be
// renamed; a shorthand specifier has to be desugared to `x as y` first.
function desugarEdges(ast: AnyNode, map: Map<string, string>): void {
	traverse(ast, {
		ImportSpecifier(path: AnyPath) {
			const { node } = path;
			if (node.local !== node.imported) return;
			const next = map.get(node.local.name);
			if (!next) return;
			node.imported = t.identifier(node.local.name);
			node.local = t.identifier(next);
		},
		ExportSpecifier(path: AnyPath) {
			const { node } = path;
			if (node.local !== node.exported) return;
			const next = map.get(node.local.name);
			if (!next) return;
			node.exported = t.identifier(node.local.name);
			node.local = t.identifier(next);
		},
	});
}

// A position where the name is a real reference and renaming it is safe to apply in place.
function isRenamable(path: AnyPath): boolean {
	const { node, parent } = path;
	if (!t.isIdentifier(node) || !OBF_NAME.test(node.name)) return false;
	if (t.isMemberExpression(parent) && parent.property === node && !parent.computed) return false;
	if (t.isObjectProperty(parent) && parent.key === node && !parent.computed && !parent.shorthand) return false;
	if (t.isObjectMethod(parent) && parent.key === node && !parent.computed) return false;
	if (t.isClassProperty(parent) && parent.key === node && !parent.computed) return false;
	if (t.isClassAccessorProperty(parent) && parent.key === node && !parent.computed) return false;
	if (t.isExportNamespaceSpecifier(parent) && parent.exported === node) return false;
	if ((t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) && (parent.imported === node || parent.exported === node)) return false;
	return true;
}

// Rename every obfuscated symbol into the safe namespace, in first-use order.
function renameSymbols(ast: AnyNode): number {
	const order: string[] = [];
	const seen = new Set<string>();
	traverse(ast, {
		Identifier(path: AnyPath) {
			const { name } = path.node;
			if (!OBF_NAME.test(name) || seen.has(name)) return;
			seen.add(name);
			order.push(name);
		},
	});
	if (!order.length) return 0;
	const prefix = safePrefix(ast);
	const map = new Map(order.map((name, i) => [name, `${prefix}${i + 1}`]));
	desugarEdges(ast, map);
	traverse(ast, {
		Identifier(path: AnyPath) {
			if (!isRenamable(path)) return;
			const next = map.get(path.node.name);
			if (next) path.node.name = next;
		},
	});
	return map.size;
}

type Result = { code: string; decoded: number; renamed: number } | null;

function deobfuscate(code: string, label: string): Result {
	let ast: AnyNode;
	try {
		ast = parse(code);
	} catch {
		return null;
	}
	const prologues = findPrologues(ast);
	if (!prologues.length) return null;

	let decoded = 0;
	for (const prologue of prologues) {
		const decoder = makeDecoder(prologue);
		if (!decoder) continue;
		const aliases = decoderAliases(ast, prologue.decoderName);
		const { total, done } = decodeCalls(ast, aliases, decoder);
		decoded += done;
		// only strip the helpers when nothing is left calling them
		if (done === total && total > 0) stripPrologue(ast, aliases, prologue.factoryName);
	}
	if (!decoded) return null;

	const renamed = renameSymbols(ast);
	const out = generate(ast, { comments: true, concise: false, compact: false, jsescOption: { minimal: true } }).code;
	return { code: `// ${label} — deobfuscated: ${decoded} strings resolved, ${renamed} names renamed.\n${out}`, decoded, renamed };
}

// --- cli -------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const input = resolve(ROOT, flag("in", "shasta/dist/assets"));
const output = resolve(ROOT, flag("out", "shasta/dist/deob"));
const only = flag("only", "");

if (!existsSync(input)) {
	console.error(`no such input: ${input}\nbuild first (bun run build), or pass --in <dir>`);
	process.exit(1);
}

const files: string[] = [];
const walk = (dir: string) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full);
		else files.push(full);
	}
};
walk(input);

mkdirSync(output, { recursive: true });
let done = 0;
let copied = 0;
const skipped: string[] = [];

for (const file of files) {
	const rel = relative(input, file);
	if (only && !rel.includes(only)) continue;
	const dest = join(output, rel);
	mkdirSync(join(dest, ".."), { recursive: true });
	if (extname(file) === ".js") {
		const result = deobfuscate(readFileSync(file, "utf8"), rel);
		if (result) {
			writeFileSync(dest, result.code);
			console.log(`deobfuscated  ${rel}  (${result.decoded} strings, ${result.renamed} names)`);
			done++;
			continue;
		}
		skipped.push(rel);
	}
	cpSync(file, dest);
	copied++;
}

console.log(`\n${done} deobfuscated, ${copied} copied as-is -> ${relative(ROOT, output)}`);
if (skipped.length) {
	const sample = skipped.slice(0, 6).join(", ");
	console.log(`${skipped.length} file(s) had no string array: ${sample}${skipped.length > 6 ? ", …" : ""}`);
}
