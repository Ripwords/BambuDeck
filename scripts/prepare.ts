export {};

if (
  !process.env.CI &&
  process.env.NODE_ENV !== "production" &&
  (await Bun.file(".git/HEAD").exists())
) {
  const { default: husky } = await import("husky");
  const result = husky();
  if (result) console.info(result);
}
