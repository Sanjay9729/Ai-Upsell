import fs from "fs";

function buildExtensionProjects() {
  const projects = {};

  let extensions = [];
  try {
    extensions = fs.readdirSync("./extensions");
  } catch {
    // no extensions present
  }

  for (const entry of extensions) {
    const extensionPath = `./extensions/${entry}`;
    const schema = `${extensionPath}/schema.graphql`;
    if (!fs.existsSync(schema)) continue;

    projects[entry] = {
      schema,
      documents: [`${extensionPath}/**/*.graphql`],
      extensions: {
        // GraphQL Code Generator configuration lives under the "codegen" extension.
        codegen: {
          generates: {
            [`${extensionPath}/generated/graphql.ts`]: {
              plugins: ["typescript", "typescript-operations"],
            },
          },
        },
      },
    };
  }

  return projects;
}

export default {
  projects: buildExtensionProjects(),
};
