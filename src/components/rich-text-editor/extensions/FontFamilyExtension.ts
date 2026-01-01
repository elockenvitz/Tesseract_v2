import { Extension } from '@tiptap/core'

export interface FontFamilyOptions {
  types: string[]
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontFamily: {
      setFontFamily: (fontFamily: string) => ReturnType
      unsetFontFamily: () => ReturnType
    }
  }
}

export const FontFamilyExtension = Extension.create<FontFamilyOptions>({
  name: 'fontFamily',

  addOptions() {
    return {
      types: ['textStyle']
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: element => {
              // Only parse if there's an explicit inline font-family style
              const inlineStyle = element.getAttribute('style')
              if (!inlineStyle || !inlineStyle.includes('font-family')) {
                return null
              }
              return element.style.fontFamily?.replace(/['"]+/g, '') || null
            },
            renderHTML: attributes => {
              if (!attributes.fontFamily) {
                return {}
              }
              return {
                style: `font-family: ${attributes.fontFamily}`
              }
            }
          }
        }
      }
    ]
  },

  addCommands() {
    return {
      setFontFamily:
        (fontFamily: string) =>
        ({ chain }) => {
          return chain().setMark('textStyle', { fontFamily }).run()
        },
      unsetFontFamily:
        () =>
        ({ chain }) => {
          return chain()
            .setMark('textStyle', { fontFamily: null })
            .removeEmptyTextStyle()
            .run()
        }
    }
  }
})
