import ts from "typescript";

/** Check the actual tool row AST; comments and unrelated matching text cannot satisfy it. */
export function verifyToolDispatchContract(source) {
  const file = ts.createSourceFile(
    "product-shell.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes = (root, predicate) => {
    const found = [];
    const visit = (node) => {
      if (predicate(node)) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
  };
  const compact = (node) => node?.getText(file).replace(/\s+/g, "");
  const require = (condition, message) => {
    if (!condition) throw new Error(`Tool dispatch contract: ${message}`);
  };
  const declarations = nodes(
    file,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === "renderToolViewSeat",
  );
  require(declarations.length === 1, "one tool-row dispatcher must exist");
  const initializer = declarations[0].initializer;
  require(initializer &&
    ts.isCallExpression(initializer) &&
    compact(initializer.expression) ===
      "useCallback", "dispatcher must use useCallback");
  const callback = initializer.arguments[0];
  require(callback &&
    ts.isArrowFunction(
      callback,
    ), "tool-row dispatcher must be the useCallback function");
  const owners = nodes(
    callback,
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText(file) === "owner",
  );
  const owner = owners[0]?.initializer;
  require(owners.length === 1 &&
    owner &&
    ts.isObjectLiteralExpression(
      owner,
    ), "one enriched owner must be constructed");
  const [base, ...additions] = owner.properties;
  require(base &&
    ts.isSpreadAssignment(base) &&
    compact(base.expression) ===
      "request.owner", "preserve the complete row-computed owner");
  const expected = new Map([
    ["loadImage", ["loadMessageImage", "loadMessageImage"]],
    [
      "inspect",
      [
        "trajectory.inspectCall",
        "()=>trajectory.inspectCall?.(request.owner.callId)",
      ],
    ],
  ]);
  require(additions.length ===
    expected.size, "only the reviewed image loader and call inspector may extend the row");
  for (const addition of additions) {
    if (ts.isPropertyAssignment(addition) && addition.name.getText(file) === "loadImage") {
      require(compact(addition.initializer) === "loadMessageImage", "forward the actual image loader");
      require(nodes(callback, node => ts.isIfStatement(node) && compact(node.expression) === "!loadMessageImage" && compact(node.thenStatement) === "returnrequest.fallback;").length === 1, "missing required-loader fallback guard");
      expected.delete("loadImage");
      continue;
    }
    require(ts.isSpreadAssignment(
      addition,
    ), "do not overwrite row identity with direct properties");
    let expression = addition.expression;
    while (ts.isParenthesizedExpression(expression))
      expression = expression.expression;
    require(ts.isConditionalExpression(
      expression,
    ), "optional owner capability must be conditional");
    require(ts.isObjectLiteralExpression(expression.whenTrue) &&
      ts.isObjectLiteralExpression(expression.whenFalse) &&
      expression.whenFalse.properties.length ===
        0, "absent capability must add no property");
    const property = expression.whenTrue.properties[0];
    require(expression.whenTrue.properties.length === 1 &&
      property &&
      ts.isPropertyAssignment(
        property,
      ), "one capability per conditional spread");
    const name = property.name.getText(file),
      contract = expected.get(name);
    require(contract &&
      compact(expression.condition) === contract[0] &&
      compact(property.initializer) ===
        contract[1], `unexpected capability or call identity: ${name}`);
    expected.delete(name);
  }
  require(expected.size ===
    0, "image loader and inspector must both be forwarded");
  const dispatches = nodes(
    callback,
    (node) =>
      ts.isCallExpression(node) &&
      compact(node.expression) === "renderSlot" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "tool.call.toolview",
  );
  require(dispatches.length ===
    1, "dispatch the official tool seat exactly once");
  const call = dispatches[0];
  require(compact(call.arguments[1]) ===
    "owner", "pass the enriched row owner to the official seat");
  const options = call.arguments[2];
  require(options &&
    ts.isObjectLiteralExpression(options), "dispatch options must be explicit");
  require(options.properties.length === 2 &&
    options.properties.every((p) =>
      ts.isPropertyAssignment(p),
    ), "only explicit entryKey and fallback options are allowed");
  const field = (name) =>
    options.properties.find(
      (p) => ts.isPropertyAssignment(p) && p.name.getText(file) === name,
    )?.initializer;
  require(compact(field("entryKey")) ===
    "request.owner.toolName", "dispatch by wire tool name");
  require(compact(field("fallback")) ===
    "renderOfficialToolFallback(owner,request.fallback)", "retain both the semantic fallback and original native row");
}
