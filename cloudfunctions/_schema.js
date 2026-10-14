// cloudfunctions/_schema.js
// 智游策划师 - 数据集合设计（开发参考字典，不参与运行时）
// 位置：cloudfunctions/ 根目录下，文件名前缀 _ 表示非云函数，不会被部署
// 约定：
//   1. 所有金额字段统一以「分」为单位存储（integer），前端展示时 formatMoney 转元
//   2. 所有时间字段统一以「毫秒时间戳」存储（number），便于排序与跨时区处理
//   3. 业务主键 _id 由云数据库自动生成；关联字段用 *_id 命名，存被关联记录的 _id
//   4. 每个集合自带 _openid（创建者），用于权限隔离
//   5. 软删除：status 字段控制，不物理删除

/* ============================================================
 * staff  员工白名单（鉴权用，login 云函数读取）
 * ============================================================
 * {
 *   _id:        string,
 *   _openid:    string,
 *   name:       string,
 *   phone:      string,
 *   role:       'planner'|'admin',
 *   status:     'active'|'disabled',
 *   avatarUrl:  string,
 *   inviteCode: string,
 *   createdAt:  number,
 *   updatedAt:  number
 * }
 * 权限：仅创建者可读写自己的档案；admin 角色可读全部（云函数内 bypass）
 */

/* ============================================================
 * customer  客户档案
 * ============================================================
 * {
 *   _id:          string,
 *   _openid:      string,
 *   name:         string,
 *   phone:        string,
 *   wechat:       string,
 *   stage:        string,         // receive/plan/quote/bargain/deposit/contract/balance/booking/doc/traveling/done/lost
 *   preferences:  string[],       // ['亲子','蜜月','自然风光','人文历史']
 *   scenicWish:   string[],       // 想去景点名称
 *   budget:       number,         // 预算（分）
 *   travelDate:   { start:number, end:number, days:number },
 *   pax:          { adult:number, child:number, baby:number },
 *   notes: [                       // 沟通记录
 *     { ts:number, content:string, _openid:string }
 *   ],
 *   source:       string,
 *   lostReason:   string,
 *   createdAt:    number,
 *   updatedAt:    number
 * }
 */

/* ============================================================
 * scenic  景点库
 * ============================================================
 * {
 *   _id:         string,
 *   name:        string,
 *   city:        string,
 *   province:    string,
 *   address:     string,
 *   location:    { lng:number, lat:number },
 *   coverImage:  string,
 *   images:      string[],
 *   videoUrl:    string,           // 景点介绍视频（云存储 fileID）
 *   intro:       string,
 *   highlights:  string[],
 *   suitableFor: string[],
 *   ticketPrice: number,
 *   openHours:   string,
 *   duration:    number,
 *   tags:        string[],
 *   playGuide:   string,           // 游玩方式建议
 *   status:      'active'|'disabled',
 *   createdAt:   number,
 *   updatedAt:   number
 * }
 * 权限：全员可读，仅 admin 可写
 */

/* ============================================================
 * tripPlan  行程规划
 * ============================================================
 * {
 *   _id:        string,
 *   _openid:    string,
 *   customerId: string,
 *   title:      string,
 *   days: [
 *     {
 *       date:      string,
 *       city:      string,
 *       items: [
 *         {
 *           type: 'scenic'|'transport'|'meal'|'hotel'|'custom',
 *           refId: string,
 *           name:  string,
 *           note:  string,
 *           startTime: string,
 *           endTime:   string
 *         }
 *       ],
 *       transport: string,
 *       meal:      string,
 *       hotel:    string
 *     }
 *   ],
 *   status:     'draft'|'confirmed'|'archived',
 *   version:    number,
 *   shareToken: string,          // 12 位分享 token（去除易混淆字符 IO01）；getShared 按 token 只读访问
 *   createdAt:  number,
 *   updatedAt:  number
 * }
 */

/* ============================================================
 * flightQuery  机票查询（携程字段对齐）
 * ============================================================
 * {
 *   _id:       string,
 *   _openid:   string,
 *   tripId:    string,
 *   customerId:string,
 *   from:      string,             // 'KMG'
 *   to:        string,             // 'LJG'
 *   fromDate:  string,
 *   retDate:   string,
 *   tripType:  'ow'|'rt',
 *   options: [
 *     {
 *       flightNo:   string,
 *       airline:    string,
 *       aircraft:   string,
 *       depTime:    string,
 *       arrTime:    string,
 *       depAirport: string,
 *       arrAirport: string,
 *       cabin:      string,
 *       price:      number,
 *       tax:        number,
 *       total:      number,
 *       discount:   string,
 *       stock:      number,
 *       source:     'mock'|'ctrip'
 *     }
 *   ],
 *   selectedOption: number,
 *   status:     'active'|'archived',   // 软删除字段
 *   createdAt: number,
 *   updatedAt: number
 * }
 */

/* ============================================================
 * hotelPlan  酒店方案
 * ============================================================
 * {
 *   _id:       string,
 *   _openid:   string,
 *   tripId:    string,
 *   customerId:string,
 *   city:      string,
 *   checkIn:   string,
 *   checkOut:  string,
 *   rooms:     number,
 *   guests:    { adult:number, child:number },
 *   budget:    number,
 *   star:      number[],
 *   location:  string,
 *   options: [
 *     {
 *       name:       string,
 *       star:       number,
 *       price:      number,
 *       totalPrice: number,
 *       roomType:   string,
 *       breakfast:  boolean,
 *       cancelable: boolean,
 *       image:      string,
 *       facilities: string[],     // 配套服务：泳池/SPA/健身房等
 *       intro:      string,        // 酒店介绍
 *       bookType:   'self'|'agent',
 *       source:     'mock'|'ctrip'
 *     }
 *   ],
 *   selectedOption: number,
 *   createdAt: number
 * }
 */

/* ============================================================
 * quote  报价单（版本历史可追溯）
 * ============================================================
 * {
 *   _id:        string,
 *   _openid:    string,
 *   customerId: string,
 *   tripId:     string,
 *   version:    number,
 *   items: [
 *     {
 *       type:  'flight'|'hotel'|'scenic'|'transport'|'meal'|'guide'|'insurance'|'other',
 *       name:  string,
 *       spec:  string,
 *       qty:   number,
 *       price: number,
 *       cost:  number
 *     }
 *   ],
 *   total:      number,
 *   costTotal:  number,
 *   profit:     number,
 *   status:     'draft'|'sent'|'bargaining'|'confirmed'|'archived',
 *   adjustHistory: [
 *     {
 *       version:   number,
 *       total:     number,
 *       reason:   string,
 *       _openid:  string,
 *       ts:       number
 *     }
 *   ],
 *   createdAt: number,
 *   updatedAt: number
 * }
 */

/* ============================================================
 * order  订单（合同/收款/预订/资料下发状态）
 * ============================================================
 * {
 *   _id:           string,
 *   _openid:       string,
 *   customerId:    string,
 *   quoteId:       string,
 *   tripId:        string,
 *   totalAmount:   number,
 *   deposit: {
 *     amount: number,
 *     paidAt: number,
 *     method:string,
 *     voucher: string,
 *     note:   string
 *   },
 *   balance: {
 *     amount: number,
 *     paidAt: number,
 *     method:string,
 *     voucher: string,
 *     note:   string
 *   },
 *   contract: {
 *     no:      string,
 *     signedAt:number,
 *     status:  'pending'|'signed'|'cancelled',
 *     file:    string
 *   },
 *   bookingStatus: {
 *     hotel: 'pending'|'done',
 *     flight:'pending'|'done',
 *     scenic:'pending'|'done',
 *     guide: 'pending'|'done'
 *   },
 *   docSent: {
 *     itinerary:    boolean,
 *     checkin:      boolean,
 *     notice:       boolean,
 *     sentAt:       number
 *   },
 *   status: 'in_progress'|'completed'|'cancelled',
 *   shareToken: string,          // 12 位分享 token（去除易混淆字符 IO01）；getShared 按 token 只读访问
 *   createdAt: number,
 *   updatedAt: number
 * }
 */

/* ============================================================
 * followup  出行跟进日志
 * ============================================================
 * {
 *   _id:      string,
 *   _openid:  string,
 *   orderId:  string,
 *   customerId:string,
 *   date:     string,
 *   content:  string,
 *   issueStatus: 'none'|'open'|'resolved',
 *   issue:    string,
 *   resolvedAt: number,
 *   images:   string[],
 *   createdAt:number
 * }
 */

/* ============================================================
 * 集合索引建议（云开发控制台手动建立）
 * ============================================================
 * - staff:        _openid
 * - customer:     _openid, stage, updatedAt
 * - scenic:       city, status
 * - tripPlan:     customerId, _openid, shareToken(唯一), updatedAt
 * - flightQuery:  customerId, tripId, _openid, updatedAt
 * - hotelPlan:    customerId, tripId, _openid
 * - quote:        customerId, status
 * - order:        customerId, status, shareToken(唯一稀疏)
 * - followup:     orderId, date
 * 注：shareToken 索引应设为「唯一索引」防止 token 冲突
 */

/* ============================================================
 * 集合权限模板
 * ============================================================
 * - staff:        仅创建者可读写自己的档案（admin 通过云函数 bypass）
 * - customer/tripPlan/quote/order/followup: 仅责任定制师可读写
 * - scenic:       全员可读，仅 admin 可写
 * - flightQuery/hotelPlan: 仅责任定制师可读写
 * 注：跨用户共享或管理员全局视角的查询，统一走云函数（云函数内 bypass 权限）
 */
