// cloudfunctions/login/index.js
// 登录鉴权云函数：内部员工白名单校验
// 调用约定：{ action: 'login' } -> { code, message, data: { openid, name, role, phone } }

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 鉴权逻辑：
 * 1. 从 wxContext 拿到 openid
 * 2. 查询 staff 集合：是否存在该 openid 的员工档案
 * 3. 若存在且 status === 'active'，返回用户信息
 * 4. 若不存在，返回 code=403，前端引导至申请权限
 *
 * staff 集合结构（数据集合设计的一部分）：
 * { _id, _openid, name, phone, role: 'planner'|'admin', status: 'active'|'disabled', createdAt, updatedAt }
 */
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;

  if (!openid) {
    return { code: 401, message: '未获取到用户身份', data: null };
  }

  try {
    const { data } = await db.collection('staff')
      .where({ _openid: openid })
      .limit(1)
      .get();

    if (!data.length) {
      // 首次使用：staff 集合为空时，自动注册当前用户为管理员
      const { total } = await db.collection('staff').count();
      if (total === 0) {
        const now = Date.now();
        await db.collection('staff').add({
          data: {
            _openid: openid,
            name: '管理员',
            phone: '',
            role: 'admin',
            status: 'active',
            avatarUrl: '',
            inviteCode: 'ADMIN001',
            createdAt: now,
            updatedAt: now
          }
        });
        return {
          code: 0,
          message: 'ok（首次自动注册管理员）',
          data: { openid, authorized: true, name: '管理员', phone: '', role: 'admin', avatarUrl: '' }
        };
      }
      return {
        code: 403,
        message: '您不在内部员工白名单内，请联系管理员添加',
        data: { openid, authorized: false }
      };
    }

    const staff = data[0];
    if (staff.status !== 'active') {
      return {
        code: 403,
        message: '您的账号已被停用，请联系管理员',
        data: { openid, authorized: false }
      };
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        openid,
        authorized: true,
        name: staff.name,
        phone: staff.phone,
        role: staff.role || 'planner',
        avatarUrl: staff.avatarUrl || ''
      }
    };
  } catch (err) {
    console.error('[login] 鉴权异常:', err);
    return { code: 500, message: '服务异常，请重试', data: null };
  }
};
