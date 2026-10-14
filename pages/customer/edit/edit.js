// pages/customer/edit/edit.js - 客户新建/编辑
const { STAGES } = require('../../../utils/stages.js');
const { call } = require('../../../utils/request.js');

const PREFERENCE_OPTIONS = [
  '亲子', '蜜月', '家庭', '老人', '自然风光', '人文历史',
  '美食', '摄影', '户外探险', '海岛度假', '购物', '休闲度假'
];
const SOURCE_OPTIONS = ['老客户', '转介绍', '小红书', '抖音', '到店', '朋友圈', '线上咨询', '其他'];

Page({
  data: {
    isEdit: false,
    id: '',
    form: {
      name: '', phone: '', wechat: '', stage: 'receive', source: '',
      preferences: [], scenicWishText: '', budget: '',
      travelStart: '', travelEnd: '', adult: '', child: '', baby: '', firstNote: ''
    },
    preferenceOptions: PREFERENCE_OPTIONS,
    sourceOptions: SOURCE_OPTIONS,
    stageOptions: STAGES.filter(s => s.key !== 'lost'),
    stagePickerIndex: 0,
    sourcePickerIndex: 0,
    submitting: false
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ isEdit: true, id: options.id });
      wx.setNavigationBarTitle({ title: '编辑客户' });
      this.loadCustomer(options.id);
    } else {
      wx.setNavigationBarTitle({ title: '新建客户' });
    }
  },

  async loadCustomer(id) {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await call('customer', { action: 'get', id }, { showError: false });
      const c = res.customer || {};
      const stageIdx = this.data.stageOptions.findIndex(s => s.key === c.stage);
      const sourceIdx = SOURCE_OPTIONS.indexOf(c.source);

      this.setData({
        form: {
          name: c.name || '', phone: c.phone || '', wechat: c.wechat || '',
          stage: c.stage || 'receive', source: c.source || '',
          preferences: c.preferences || [],
          scenicWishText: (c.scenicWish || []).join('，'),
          budget: c.budget ? String(c.budget / 100) : '',
          travelStart: (c.travelDate && c.travelDate.start) ? formatDate(c.travelDate.start) : '',
          travelEnd: (c.travelDate && c.travelDate.end) ? formatDate(c.travelDate.end) : '',
          adult: c.pax && c.pax.adult ? String(c.pax.adult) : '',
          child: c.pax && c.pax.child ? String(c.pax.child) : '',
          baby: c.pax && c.pax.baby ? String(c.pax.baby) : '',
          firstNote: ''
        },
        stagePickerIndex: stageIdx >= 0 ? stageIdx : 0,
        sourcePickerIndex: sourceIdx >= 0 ? sourceIdx : 0
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    wx.hideLoading();
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onStageChange(e) {
    const idx = Number(e.detail.value);
    this.setData({ stagePickerIndex: idx, 'form.stage': this.data.stageOptions[idx].key });
  },

  onSourceChange(e) {
    const idx = Number(e.detail.value);
    this.setData({ sourcePickerIndex: idx, 'form.source': SOURCE_OPTIONS[idx] });
  },

  onDateChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onPrefTap(e) {
    const pref = e.currentTarget.dataset.pref;
    const list = this.data.form.preferences.slice();
    const idx = list.indexOf(pref);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(pref);
    this.setData({ 'form.preferences': list });
  },

  onAddCustomPref() {
    wx.showModal({
      title: '添加自定义偏好',
      editable: true,
      placeholderText: '如：滑雪爱好者',
      success: (res) => {
        if (res.confirm && res.content && res.content.trim()) {
          const list = this.data.form.preferences.slice();
          list.push(res.content.trim());
          this.setData({ 'form.preferences': list });
        }
      }
    });
  },

  async onSubmit() {
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请填写客户姓名', icon: 'none' });
    if (!/^1\d{10}$/.test(f.phone)) return wx.showToast({ title: '手机号格式不正确', icon: 'none' });
    if (f.travelStart && f.travelEnd && f.travelStart > f.travelEnd) {
      return wx.showToast({ title: '结束日期需晚于开始日期', icon: 'none' });
    }

    const payload = {
      name: f.name.trim(), phone: f.phone, wechat: f.wechat.trim(),
      stage: f.stage, source: f.source, preferences: f.preferences,
      scenicWish: f.scenicWishText ? f.scenicWishText.split(/[，,\s]+/).filter(Boolean) : [],
      budget: f.budget ? Number(f.budget) : 0,
      travelDate: f.travelStart ? {
        start: new Date(f.travelStart).getTime(),
        end: f.travelEnd ? new Date(f.travelEnd).getTime() : new Date(f.travelStart).getTime(),
        days: daysBetween(f.travelStart, f.travelEnd || f.travelStart)
      } : null,
      pax: { adult: Number(f.adult) || 0, child: Number(f.child) || 0, baby: Number(f.baby) || 0 }
    };
    if (!this.data.isEdit) payload.firstNote = f.firstNote.trim();

    this.setData({ submitting: true });
    try {
      const action = this.data.isEdit ? 'update' : 'create';
      const args = { action, ...payload };
      if (this.data.isEdit) args.id = this.data.id;
      await call('customer', args, { loading: true });
      wx.showToast({ title: this.data.isEdit ? '已更新' : '已创建', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {}
    this.setData({ submitting: false });
  }
});

function formatDate(ts) {
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(startStr, endStr) {
  const s = new Date(startStr).getTime();
  const e = new Date(endStr).getTime();
  return Math.floor((e - s) / 86400e3) + 1;
}
