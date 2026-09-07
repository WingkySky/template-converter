// 将打包的第三方库暴露为全局变量，供过渡期 legacy.js 使用（阶段 3 结束删除）。
// xlsx 来自 SheetJS 官方 0.20.1 tarball，与原 CDN 脚本为同一产物；exceljs 4.4.0 与原 CDN 同版本。
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

Object.assign(window, { XLSX, ExcelJS });
