import type { Locale } from '@open-artifact/core'

// The SDK runs as plain script text in the artifact frame, so its words travel as JSON: `{number}` stands for a pin's number.
const zhCN = {
  pins: '评论标注',
  commentSelection: '评论选中的文字',
  comment: '评论',
  pin: '评论 {number}',
  resolvedPin: '评论 {number}，已解决',
  marks: { changed: '改', added: '新', removed: '删' },
  was: '原来：',
  removed: '删掉了：',
  blockKinds: {
    heading: '标题',
    table: '表格',
    figure: '图',
    image: '图片',
    video: '视频',
    code: '代码',
    quote: '引用',
    listItem: '列表项',
    paragraph: '段落',
    term: '术语',
    definition: '释义',
    block: '区块',
  },
}

const en: typeof zhCN = {
  pins: 'Comment pins',
  commentSelection: 'Comment on the selected text',
  comment: 'Comment',
  pin: 'Comment {number}',
  resolvedPin: 'Comment {number}, resolved',
  marks: { changed: '~', added: '+', removed: '−' },
  was: 'Was: ',
  removed: 'Removed: ',
  blockKinds: {
    heading: 'Heading',
    table: 'Table',
    figure: 'Figure',
    image: 'Image',
    video: 'Video',
    code: 'Code',
    quote: 'Quote',
    listItem: 'List item',
    paragraph: 'Paragraph',
    term: 'Term',
    definition: 'Definition',
    block: 'Block',
  },
}

/** What the SDK shows inside the frame, by language; the viewer says which language once the frame is listening. */
export const SDK_MESSAGES: Record<Locale, typeof zhCN> = { 'zh-CN': zhCN, en }
