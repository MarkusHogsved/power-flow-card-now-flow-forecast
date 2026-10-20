import resolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/power-flow-card-now-flow-forecast.ts",
  output: {
    file: "dist/power-flow-card-now-flow-forecast.js",
    format: "es",
    inlineDynamicImports: true,
  },
  plugins: [
    resolve(),
    typescript({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"], noEmit: false, declaration: false }),
    terser({ format: { comments: false } }),
  ],
};
