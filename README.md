# 智游策划师（zhiyou-planner）

面向旅游从业人员的**全流程策划工具**微信小程序。从客户接待、行程规划、报价议价，到合同签署、收款、落地预订、资料下发，把定制师的一整套业务流程搬进微信，基于小程序云开发实现，无需自建服务器。

---

## 功能概览

| 模块 | 页面 | 能力 |
| --- | --- | --- |
| 工作台 | `pages/index` | 业务概览、待办聚合、快速入口 |
| 客户管理 | `pages/customer/list`、`edit`、`detail` | 客户档案、跟进记录、阶段推进、流失标记 |
| 景点库 | `pages/scenic/list`、`detail` | 景点资料维护、封面图自动生成、演示数据初始化 |
| 行程规划 | `pages/trip/editor`、`preview` | 多天行程编辑、按天排布、行程单预览与分享 |
| 报价单 | `pages/quote/list`、`edit`、`detail` | 报价项增删、多轮调价、报价单发送与确认 |
| 订单 | `pages/order/list`、`detail`、`preview` | 定金/尾款、合同签署、取消、完成、订单分享页 |
| 机票查询 | `pages/flight/list`、`query` | 航班需求登记与查询记录管理 |
| 酒店方案 | `pages/hotel/list`、`detail` | 酒店方案、图片与详情 |
| 我的 | `pages/profile` | 个人信息、角色与权限 |

## 业务流程阶段

客户从接待到成交的全过程由 `utils/stages.js` 统一定义，共 12 个阶段：

```
接待 → 规划 → 报价 → 议价 → 定金 → 合同 → 尾款 → 预订 → 资料下发 → 出行中 → 已完成
                                                                    ↘ 已流失
```

每个阶段带独立配色与说明，"推进阶段"按钮由 `getNextStage()` 自动计算下一状态，`已完成` 与 `已流失` 为终态。

## 技术架构

- **前端**：微信小程序原生开发（WXML / WXSS / JS），基础库 `3.4.5+`
- **后端**：小程序云开发（云函数 + 云数据库 + 云存储），无独立服务器
- **架构约定**：前端统一通过 `utils/request.js` 调用云函数，云函数统一返回 `{ code, message, data }`，`code === 0` 为成功，401/403 触发无权限弹窗，网络失败自动重试

## 目录结构

```
├── app.js / app.json / app.wxss    小程序入口、全局配置与样式
├── pages/                          19 个业务页面
├── cloudfunctions/                 8 个云函数
│   ├── login/                      登录鉴权（员工白名单）
│   ├── customer/                   客户与跟进
│   ├── scenic/                     景点库
│   ├── tripPlan/                   行程方案
│   ├── quote/                      报价单
│   ├── order/                      订单与收款
│   ├── flightQuery/                机票查询
│   ├── hotelPlan/                  酒店方案
│   └── _schema.js                  数据集合结构说明
├── utils/
│   ├── request.js                  云函数调用封装
│   ├── stages.js                   业务阶段定义
│   └── format.js                   格式化工具
└── project.config.json             小程序项目配置（含 appid）
```

## 云函数与数据集合

| 集合 | 说明 | 对应云函数 |
| --- | --- | --- |
| `staff` | 内部员工档案与角色（planner / admin） | `login` |
| `customer` | 客户档案与跟进记录 | `customer` |
| `scenic` | 景点资料 | `scenic` |
| `tripPlan` | 行程方案 | `tripPlan` |
| `quote` | 报价单 | `quote` |
| `order` | 订单与收款状态 | `order` |
| `flightQuery` | 机票查询记录 | `flightQuery` |
| `hotelPlan` | 酒店方案 | `hotelPlan` |

云函数通过 `action` 参数分发，例如 `customer` 提供 `list / create / update / addNote / advanceStage / dashboard / lost`，`order` 提供 `create / payDeposit / signContract / payBalance / updateBooking / sendDoc / complete / cancel / getShared` 等。

## 部署步骤

1. **导入项目**
   微信开发者工具 → 导入项目 → 选择本目录 → 在 `project.config.json` 中把 `appid` 改成你自己的小程序 AppID。

2. **开通云开发**
   开发者工具顶部「云开发」→ 开通环境 → 记下**环境 ID** → 填入 `app.js` 的 `globalData.cloudEnvId`（留空则使用默认环境）。

3. **创建数据集合**
   云开发控制台 → 数据库 → 新建上表 8 个集合。建议权限设为「仅创建者可读写」，由云函数统一代理访问。

4. **部署云函数**
   对每个云函数目录右键 → 「上传并部署：云端安装依赖」。
   > `flightQuery` 目录若本地已有 `node_modules`，部署前先在该目录执行 `npm install`（本仓库已忽略 `node_modules`，需自行安装）。

5. **初始化演示数据（可选）**
   调用 `scenic` 的 `initDemo`、`hotelPlan` 的 `initDemo` action，可一键写入示例景点与酒店数据。

6. **首次登录**
   `staff` 集合为空时，第一个登录的微信用户会被**自动注册为管理员**，后续成员需由管理员在 `staff` 集合中新增记录后才可登录。

## 权限说明

本项目定位为**内部工具**，不是面向 C 端用户的开放小程序：

- 启动时调用 `login` 云函数做静默登录
- 仅 `staff` 集合中 `status === 'active'` 的成员可使用，其余返回 `403` 并提示联系管理员
- 行程与订单支持生成 `shareToken`，可对外分享只读页面（数据已脱敏），重置 token 即撤销分享链接

## 注意事项

- **AppID**：仓库中 `project.config.json` 保留了开发时使用的 AppID，部署前请替换为自有 AppID。
- **图片服务**：景点封面、酒店图片默认调用外部图片生成接口，若要在生产环境使用，请在小程序后台将其域名加入 `request` 合法域名，或改为自有图床。
- **云环境**：`app.js` 中 `env` 字段区分 `develop` / `prod`，切换环境时注意同步云环境 ID。
- **依赖**：云函数统一依赖 `wx-server-sdk`（`~2.6.3`）。
