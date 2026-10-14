export {};

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
  throw new Error("Pass a release version");
const changelog = await Bun.file("CHANGELOG.md").text();
const sections = changelog.split(/(?=^## )/m);
const section = sections.find((entry) => {
  const headingVersion = entry.match(/^## \[?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1];
  return headingVersion === version;
});
if (!section) throw new Error(`No changelog entry for ${version}`);
console.log(
  `${section.trim()}\n\n### Docker\n\n\`ripwords/bambudeck:${version}\` supports AMD64 and ARM64.\n\nDownload the attached \`compose.production.yaml\`, then run:\n\n\`\`\`sh\ndocker compose -f compose.production.yaml up -d\n\`\`\`\n\n[Documentation](https://ripwords.github.io/BambuDeck/)`,
);
