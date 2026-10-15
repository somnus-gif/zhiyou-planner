// pages/scenic/edit/edit.js - 景点新建 / 编辑 / 下架
const { call } = require('../../../utils/request.js');

const SUITABLE_OPTIONS = ['亲子', '蜜月', '家庭', '老人', '文艺青年', '摄影', '美食', '购物', '户外探险', '休闲度假'];
const TAG_OPTIONS = ['自然风光', '人文历史', '古城', '海岛', '火山', '瀑布', '梯田', '宫殿', '教堂', '步行街', '海滩', '广场', '博物馆', '地标'];

Page({
  data: {
    isEdit: false,
    id: '',
    form: {
      name: '', city: '', province: '', address: '',
      ticketPrice: '', duration: '', openHours: '',
      intro: '', highlightsText: '', playGuide: '',
      suitableFor: [], tags: [], coverImage: ''
    },
    suitableOptions: [],
    tagOptions: [],
    submitting: false,
    uploading: false
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ isEdit: true, id: options.id });
      wx.setNavigationBarTitle({ title: '编辑景点' });
      this.loadScenic(options.id);
    } else {
      wx.setNavigationBarTitle({ title: '新建景点' });
      this.buildOptions();
    }
  },

  async loadScenic(id) {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await call('scenic', { action: 'get', id }, { showError: false });
      const s = res.scenic || {};
      this.setData({
        form: {
          name: s.name || '', city: s.city || '', province: s.province || '',
          address: s.address || '',
          ticketPrice: s.ticketPrice ? String(s.ticketPrice / 100) : '',
          duration: s.duration ? String(s.duration) : '',
          openHours: s.openHours || '',
          intro: s.intro || '',
          highlightsText: (s.highlights || []).join('，'),
          playGuide: s.playGuide || '',
          suitableFor: s.suitableFor || [],
          tags: s.tags || [],
          coverImage: s.coverImage || ''
        }
      }, () => this.buildOptions());
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    wx.hideLoading();
  },

  buildOptions() {
    const f = this.data.form;
    const suitable = SUITABLE_OPTIONS.map(t => ({ label: t, on: f.suitableFor.indexOf(t) >= 0 }));
    const custom = (f.tags || []).filter(t => TAG_OPTIONS.indexOf(t) < 0);
    const tags = TAG_OPTIONS.concat(custom).map(t => ({ label: t, on: f.tags.indexOf(t) >= 0 }));
    this.setData({ suitableOptions: suitable, tagOptions: tags });
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onMultiTap(e) {
    const { field, label } = e.currentTarget.dataset;
    const list = (this.data.form[field] || []).slice();
    const i = list.indexOf(label);
    if (i >= 0) list.splice(i, 1); else list.push(label);
    this.setData({ ['form.' + field]: list }, () => this.buildOptions());
  },  onAddCustomTag() {
    wx.showModal({
      title: '添加自定义标签',
      editable: true,
      placeholderText: '如：温泉',
      success: (r) => {
        if (!r.confirm || !r.content || !r.content.trim()) return;
        const v = r.content.trim();
        const list = (this.data.form.tags || []).slice();
        if (list.indexOf(v) < 0) list.push(v);
        this.setData({ 'form.tags': list }, () => this.buildOptions());
      }
    });
  },

  async onUploadCover() {
    if (this.data.uploading) return;
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1, mediaType: ['image'],
        sourceType: ['album', 'camera'], sizeType: ['compressed']
      });
      const file = (chooseRes.tempFiles || [])[0];
      if (!file) return;
      this.setData({ uploading: true });
      wx.showLoading({ title: '上传中...', mask: true });
      const cloudPath = 'scenic/' + (this.data.id || 'new') + '_cover_' + Date.now() + '.jpg';
      const res = await wx.cloud.uploadFile({ cloudPath, filePath: file.tempFilePath });
      wx.hideLoading();
      this.setData({ uploading: false, 'form.coverImage': res.fileID });
    } catch (err) {
      wx.hideLoading();
      this.setData({ uploading: false });
      if (err.errMsg && err.errMsg.indexOf('cancel') >= 0) return;
      wx.showToast({ title: '上传失败', icon: 'none' });
    }
  },

  onRemoveCover() {
    this.setData({ 'form.coverImage': '' });
  },

  async onSubmit() {
    const f = this.data.form;
    if (!f.name || !f.name.trim()) return wx.showToast({ title: '请填写景点名称', icon: 'none' });

    const payload = {
      name: f.name.trim(),
      city: f.city.trim(),
      province: f.province.trim(),
      address: f.address.trim(),
      ticketPrice: f.ticketPrice ? Number(f.ticketPrice) : 0,
      duration: f.duration ? Number(f.duration) : 0,
      openHours: f.openHours.trim(),
      intro: f.intro.trim(),
      highlights: f.highlightsText ? f.highlightsText.split(/[，,\s]+/).filter(Boolean) : [],
      playGuide: f.playGuide.trim(),
      suitableFor: f.suitableFor,
      tags: f.tags,
      coverImage: f.coverImage || ''
    };

    this.setData({ submitting: true });
    try {
      if (this.data.isEdit) {
        await call('scenic', { action: 'update', id: this.data.id, ...payload }, { loading: true });
        wx.showToast({ title: '已更新', icon: 'success' });
      } else {
        await call('scenic', { action: 'create', ...payload }, { loading: true });
        wx.showToast({ title: '已创建', icon: 'success' });
      }
      setTimeout(() => wx.navigateBack(), 700);
    } catch (e) {}
    this.setData({ submitting: false });
  },

  onDelete() {
    if (!this.data.isEdit) return;
    wx.showModal({
      title: '下架景点',
      content: '下架后该景点将不在景点库中显示，确定？',
      confirmText: '下架',
      confirmColor: '#FF4D4F',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('scenic', { action: 'remove', id: this.data.id }, { loading: true });
          wx.showToast({ title: '已下架', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 700);
        } catch (e) {}
      }
    });
  }
});