import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 默认构建：dist/（多文件，相对路径，适合挂网静态托管）
// 单文件构建：vite build --mode single → dist-single/index.html
//   （JS/CSS/xlsx/exceljs 全部内联，无外部请求，双击即可在浏览器打开——
//    file:// 仅限制「外部」模块脚本，内联模块不受 CORS 限制）
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    build: {
      target: 'es2020',
      outDir: single ? 'dist-single' : 'dist',
      ...(single
        ? {
            assetsInlineLimit: 100000000,
            cssCodeSplit: false,
            rollupOptions: { output: { inlineDynamicImports: true } },
          }
        : {}),
    },
    plugins: single ? [viteSingleFile()] : [],
  };
});
