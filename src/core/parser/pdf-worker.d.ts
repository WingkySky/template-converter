// pdfjs-dist 仅为主入口提供类型；worker 子路径按包内文件直接引用（包无 exports 字段，
// 各构建产物均可直接寻址），此处补环境模块声明以通过 noImplicitAny。
declare module 'pdfjs-dist/build/pdf.worker.min.mjs';
