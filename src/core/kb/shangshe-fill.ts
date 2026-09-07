// 商社信息填充/银行归属地/备注预设值 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 B）。
// 原 legacy.js 锚点：BANK_LOCATION_NAMES L1146、BANK_LOCATION_PROVINCES L1177、
// inferBankLocationFromBranch L1179、fillShangSheInfoForRow L2668、getRemarkPresetValue L2841。
// 去 loadKB/state 化说明（唯一结构性改动）：
//  - fillShangSheInfoForRow 内部调用 taxSourceForPlatform(rowPlatform)（原第二参缺省时
//    兜底 loadKB()），改为 kb 提升为第一个参数，导出名加 kb 前缀；legacy.js 保留原签名包装。
//  - getRemarkPresetValue 原函数读 state.outputRows/outputRowMeta/outputHeaders/sources
//    与 document（自定义备注文本），并调用 loadKB()。core 侧改为 kb + 显式上下文参数
//    RemarkPresetContext（各字段与原表达式一一对应），rowIdx 仅用于 state 索引故从核心签名移除；
//    legacy 包装函数照原表达式取值后传入（各读取均为无副作用读取，急切求值行为等价）。
import type { Cell, Row, Rows } from '../../types';
import type { KB } from './model';
import { kbTaxSourceForPlatform } from './tax-source';
import { inferWorkType } from './task';
import type { ShangSheLookup } from './shangshe';

const BANK_LOCATION_NAMES = [
  '北京','上海','天津','重庆','香港','澳门',
  '广州','深圳','珠海','汕头','佛山','韶关','湛江','肇庆','江门','茂名','惠州','梅州','汕尾','河源','阳江','清远','东莞','中山','潮州','揭阳','云浮',
  '杭州','宁波','温州','嘉兴','湖州','绍兴','金华','衢州','舟山','台州','丽水',
  '南京','苏州','无锡','常州','南通','扬州','镇江','泰州','徐州','连云港','淮安','盐城','宿迁',
  '福州','厦门','泉州','漳州','莆田','三明','南平','龙岩','宁德',
  '长沙','株洲','湘潭','衡阳','邵阳','岳阳','常德','张家界','益阳','郴州','永州','怀化','娄底','湘西',
  '武汉','黄石','十堰','宜昌','襄阳','鄂州','荆门','孝感','荆州','黄冈','咸宁','随州','恩施',
  '郑州','开封','洛阳','平顶山','安阳','鹤壁','新乡','焦作','濮阳','许昌','漯河','三门峡','南阳','商丘','信阳','周口','驻马店','济源',
  '合肥','芜湖','蚌埠','淮南','马鞍山','淮北','铜陵','安庆','黄山','滁州','阜阳','宿州','六安','亳州','池州','宣城',
  '南昌','景德镇','萍乡','九江','新余','鹰潭','赣州','吉安','宜春','抚州','上饶',
  '济南','青岛','淄博','枣庄','东营','烟台','潍坊','济宁','泰安','威海','日照','临沂','德州','聊城','滨州','菏泽',
  '成都','自贡','攀枝花','泸州','德阳','绵阳','广元','遂宁','内江','乐山','南充','眉山','宜宾','广安','达州','雅安','巴中','资阳','阿坝','甘孜','凉山',
  '西安','铜川','宝鸡','咸阳','渭南','延安','汉中','榆林','安康','商洛',
  '沈阳','大连','鞍山','抚顺','本溪','丹东','锦州','营口','阜新','辽阳','盘锦','铁岭','朝阳','葫芦岛',
  '长春','吉林','四平','辽源','通化','白山','松原','白城','延边',
  '哈尔滨','齐齐哈尔','鸡西','鹤岗','双鸭山','大庆','伊春','佳木斯','七台河','牡丹江','黑河','绥化','大兴安岭',
  '石家庄','唐山','秦皇岛','邯郸','邢台','保定','张家口','承德','沧州','廊坊','衡水',
  '太原','大同','阳泉','长治','晋城','朔州','晋中','运城','忻州','临汾','吕梁',
  '呼和浩特','包头','乌海','赤峰','通辽','鄂尔多斯','呼伦贝尔','巴彦淖尔','乌兰察布','兴安','锡林郭勒','阿拉善',
  '南宁','柳州','桂林','梧州','北海','防城港','钦州','贵港','玉林','百色','贺州','河池','来宾','崇左',
  '海口','三亚','三沙','儋州',
  '贵阳','六盘水','遵义','安顺','毕节','铜仁','黔西南','黔东南','黔南',
  '昆明','曲靖','玉溪','保山','昭通','丽江','普洱','临沧','楚雄','红河','文山','西双版纳','大理','德宏','怒江','迪庆',
  '拉萨','日喀则','昌都','林芝','山南','那曲','阿里',
  '兰州','嘉峪关','金昌','白银','天水','武威','张掖','平凉','酒泉','庆阳','定西','陇南','临夏','甘南',
  '西宁','海东','海北','黄南','海南','果洛','玉树','海西',
  '银川','石嘴山','吴忠','固原','中卫',
  '乌鲁木齐','克拉玛依','吐鲁番','哈密','昌吉','博尔塔拉','巴音郭楞','阿克苏','克孜勒苏','喀什','和田','伊犁','塔城','阿勒泰'
];

const BANK_LOCATION_PROVINCES = ['河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海','台湾','内蒙古','广西','西藏','宁夏','新疆'];

export function inferBankLocationFromBranch(bankName: Cell): string {
  const raw = String(bankName || '').trim();
  if (!raw) return '0';
  const text = raw.replace(/中国|股份有限公司|有限责任公司|银行|信用社|农商行|支行|分行|营业部|营业厅|储蓄所|网点/g, '');
  const city = BANK_LOCATION_NAMES.find(name => text.includes(name));
  if (city) return city;
  const province = BANK_LOCATION_PROVINCES.find(name => text.includes(name));
  return province || '0';
}

/** fillShangSheInfoForRow 的 colIndex 参数（legacy 调用点始终传全量四键） */
export interface ShangSheColIndex { platform: number; taxSource: number; taskList: number; workType: number; }

/** fillShangSheInfoForRow 的 rowContext 参数（state.outputRowMeta 元素中本函数用到的字段） */
export interface FillRowContext { rawRow?: Row; typeToCol?: Record<string, number | null>; }

export type ShangSheSetter = (colIdx: number, value: string) => void;

// 填充商社信息到行的通用函数
// out - 当前行数组（用于读取已有值判断是否为空）
// lookup - 商社查找结果
// colIndex - 列索引对象 { platform, taxSource, taskList, workType }
// setter(colIdx, value) - 写入回调（直接赋值或 updateOutputRow）
// rowContext - 用于 inferWorkType 的上下文
export function kbFillShangSheInfoForRow(
  kb: KB,
  out: Row,
  lookup: ShangSheLookup | null | undefined,
  colIndex: ShangSheColIndex,
  setter: ShangSheSetter,
  rowContext: FillRowContext | null | undefined,
): void {
  if (!lookup) return;
  const ci = (colIndex || {}) as ShangSheColIndex;
  // 填充平台
  if (ci.platform >= 0 && !out[ci.platform] && lookup.platform) {
    setter(ci.platform, lookup.platform);
  }
  // 填充税源地
  if (ci.taxSource >= 0 && !out[ci.taxSource]) {
    const rowPlatform = ci.platform >= 0 ? out[ci.platform] : '';
    const taxSource = kbTaxSourceForPlatform(kb, rowPlatform as string) || lookup.taxSource;
    if (taxSource) setter(ci.taxSource, taxSource);
  }
  // 填充任务清单和工种
  if (lookup.matchedTasks.length > 0) {
    const firstTask = lookup.matchedTasks[0];
    if (ci.taskList >= 0 && !out[ci.taskList]) {
      setter(ci.taskList, firstTask.fullString);
    }
    if (ci.workType >= 0 && !out[ci.workType]) {
      setter(ci.workType, inferWorkType(firstTask, rowContext?.rawRow, rowContext?.typeToCol));
    }
  }
}

/** getRemarkPresetValue 的上下文：各字段与原函数内的 state/document 读取一一对应 */
export interface RemarkPresetContext {
  /** 原 `state.outputRows?.[rowIdx] || []` */
  row: Row;
  /** 原 `(state.outputRowMeta?.[rowIdx] || {}).fileName` */
  metaFileName?: string;
  /** 原 `state.sources.filter(s => s.selected).map(s => s.fileName)`（filter(Boolean) 在核心内做） */
  selectedFileNames?: string[];
  /** 原 `state.outputHeaders || []` */
  outputHeaders?: string[];
  /** 原 `document.getElementById('note-custom-text')?.value.trim() || ''` */
  customText?: string;
}

export function kbGetRemarkPresetValue(kb: KB, preset: string, ctx: RemarkPresetContext): string {
  const row = ctx.row;
  if (preset === 'filename') {
    const rawName = ctx.metaFileName || (ctx.selectedFileNames || []).filter(Boolean).join('、');
    return rawName.replace(/\.[^.]+$/, '');
  }
  if (preset === 'date') {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  if (preset === 'shangshe') {
    const shangSheIdx = (ctx.outputHeaders || []).indexOf('商社编号');
    const shangSheId = shangSheIdx >= 0 ? String(row[shangSheIdx] || '').trim() : '';
    const entry = shangSheId ? kb.shangSheMap[shangSheId] : null;
    return entry?.shortName || entry?.fullName || '';
  }
  if (preset === 'custom') {
    return ctx.customText || '';
  }
  return '';
}
