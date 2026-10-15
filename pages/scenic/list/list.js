// pages/scenic/list/list.js - 景点库列表
const { call } = require('../../../utils/request.js');
const { formatMoney } = require('../../../utils/format.js');

const COVER_API = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=';
const COVER_SIZE = '&image_size=landscape_4_3';

const CITY_OPTIONS = ['全部', '马来西亚', '印尼', '新加坡', '俄罗斯'];
const TAG_OPTIONS = ['自然风光', '人文历史', '古城', '海岛', '火山', '瀑布', '梯田', '宫殿', '教堂', '步行街', '海滩', '广场', '博物馆', '地标', '亲子', '蜜月', '摄影'];

Page({
  data: {
    keyword: '',
    cityFilter: '全部',
    tagFilter: '',
    cityOptions: CITY_OPTIONS,
    tagOptions: TAG_OPTIONS,
    scenicList: [],
    pageState: 'loading',
    pageNo: 1,
    pageSize: 20,
    total: 0,
    hasMore: true,
    loadingMore: false
  },

  onLoad() {
    this.refreshList();
  },

  refreshList() {
    this.setData({ pageNo: 1, pageState: 'loading', scenicList: [] });
    this.loadList(true);
  },

  async loadList(isReset = false) {
    const pageNo = isReset ? 1 : this.data.pageNo;
    try {
      const res = await call('scenic', {
        action: 'list',
        keyword: this.data.keyword,
        city: this.data.cityFilter === '全部' ? '' : this.data.cityFilter,
        tag: this.data.tagFilter,
        pageNo,
        pageSize: this.data.pageSize
      }, { showError: false });

      const newList = (res.list || []).map(s => ({
        ...s,
        priceText: s.ticketPrice ? formatMoney(s.ticketPrice) : '免费',
        coverOrInitial: s.coverImage || s.images[0] || '',
        initial: s.name[0]
      }));

      const merged = isReset ? newList : this.data.scenicList.concat(newList);

      this.setData({
        scenicList: merged,
        total: res.total || 0,
        pageNo,
        hasMore: merged.length < (res.total || 0),
        pageState: merged.length ? 'list' : 'empty'
      });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearchConfirm() {
    this.refreshList();
  },

  onClearKeyword() {
    this.setData({ keyword: '' });
    this.refreshList();
  },

  onCityTap(e) {
    const city = e.currentTarget.dataset.city;
    if (city === this.data.cityFilter) return;
    this.setData({ cityFilter: city });
    this.refreshList();
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag;
    const newTag = tag === this.data.tagFilter ? '' : tag;
    this.setData({ tagFilter: newTag });
    this.refreshList();
  },

  onScenicTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/scenic/detail/detail?id=${id}` });
  },

  onCreateTap() {
    wx.navigateTo({ url: '/pages/scenic/edit/edit' });
  },

  async onInitDemo() {
    try {
      const res = await call('scenic', { action: 'initDemo' }, { loading: true });
      wx.showToast({ title: '已加载 ' + (res.count || 0) + ' 个景点', icon: 'success' });
      this.refreshList();
    } catch (e) {}
  },

  onPullDownRefresh() {
    this.refreshList();
    setTimeout(() => wx.stopPullDownRefresh(), 600);
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    this.loadList(false).then(() => {
      this.setData({ loadingMore: false });
    });
  },

  onRetry() {
    this.refreshList();
  }
});
