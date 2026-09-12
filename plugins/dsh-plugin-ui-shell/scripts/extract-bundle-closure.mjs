import ts from "typescript";

/** Preserve exact declaration text while following lexical symbol dependencies.
 * This is for pinned ModuleLoader bundles, not arbitrary source rewriting. */
export function extractBundleClosure(source, names) {
  const filename = "/bundle.js";
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const host = ts.createCompilerHost({
    allowJs: true,
    noLib: true,
    noResolve: true,
  });
  host.getSourceFile = (name) => (name === filename ? file : undefined);
  host.fileExists = (name) => name === filename;
  host.readFile = (name) => (name === filename ? source : undefined);
  const program = ts.createProgram(
    [filename],
    { allowJs: true, noLib: true, noResolve: true },
    host,
  );
  const checker = program.getTypeChecker();
  let body;
  function find(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(file) === "factory" &&
      ts.isArrowFunction(node.initializer)
    )
      body = node.initializer.body;
    ts.forEachChild(node, find);
  }
  find(file);
  if (!body || !ts.isBlock(body))
    throw new Error("ModuleLoader factory not found");
  const top = new Set(body.statements);
  const selected = new Set();
  function enclosing(node) {
    while (node && !top.has(node)) node = node.parent;
    return node;
  }
  function include(statement) {
    if (selected.has(statement)) return;
    selected.add(statement);
    function visit(node) {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        for (const declaration of symbol?.declarations ?? []) {
          const dependency = enclosing(declaration);
          if (dependency) include(dependency);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(statement);
  }
  for (const name of names) {
    const statement = body.statements.find(
      (node) =>
        (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
        (ts.isVariableStatement(node) &&
          node.declarationList.declarations.some(
            (d) => ts.isIdentifier(d.name) && d.name.text === name,
          )),
    );
    if (!statement) throw new Error(`Missing bundle declaration: ${name}`);
    include(statement);
  }
  return (
    body.statements
      .filter((node) => selected.has(node))
      .map((node) => node.getText(file))
      .join("\n\n") + "\n"
  );
}
