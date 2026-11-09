// Full-screen reader for an SOP: renders the sections as one HTML page in a
// WebView with JavaScript off. PDF sections show as buttons that open the file
// in the in-app browser. The footer is supplied by the caller (sign button).
import { useMemo, type ReactNode } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { WebView } from 'react-native-webview'
import * as WebBrowser from 'expo-web-browser'

import { signedUrl, type SOPSection } from '@/lib/sops'
import { palette, radius } from '@/theme/palette'

const PDF_SCHEME = 'pssop-pdf://open?path='

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function sopHtml(title: string, description: string | null, sections: SOPSection[], accent: string) {
  const body = sections
    .map((s) => {
      const level = Math.min(2 + s.depth, 4)
      let content = ''
      if (s.content_type === 'rich_text' && s.rich_content) content = s.rich_content
      if (s.content_type === 'pdf') {
        content = s.pdf_storage_path
          ? `<a class="pdf" href="${PDF_SCHEME}${encodeURIComponent(s.pdf_storage_path)}">&#128196; Open PDF: ${esc(s.title)}</a>`
          : '<p class="muted">No PDF uploaded for this section.</p>'
      }
      return `<section style="margin-left:${s.depth * 10}px"><h${level}>${esc(s.title)}</h${level}>${content}</section>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:-apple-system,Roboto,Segoe UI,sans-serif;color:#0F172A;font-size:16px;line-height:1.55;padding:16px 16px 32px;margin:0;word-wrap:break-word}
h1{font-size:22px;margin:0 0 6px}h2{font-size:19px}h3{font-size:17px}h4{font-size:16px}
h2,h3,h4{margin:22px 0 8px;color:${accent}}
.desc,.muted{color:#64748B}
img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #E2E8F0;padding:4px 6px}
a{color:${accent}}
a.pdf{display:block;padding:12px 14px;border:1px solid ${accent};border-radius:10px;text-decoration:none;font-weight:600;margin:8px 0}
</style></head><body><h1>${esc(title)}</h1>${description ? `<p class="desc">${esc(description)}</p>` : ''}${
    body || '<p class="muted">This SOP has no sections.</p>'
  }</body></html>`
}

export function SOPReader({
  visible,
  onClose,
  title,
  subtitle,
  html,
  loading,
  error,
  footer,
  accent,
}: {
  visible: boolean
  onClose: () => void
  title: string
  subtitle?: string
  html: string | null
  loading: boolean
  error: string | null
  footer?: ReactNode
  accent: string
}) {
  const source = useMemo(() => (html ? { html, baseUrl: '' } : null), [html])

  const onLink = (url: string) => {
    if (url.startsWith('about:') || url.startsWith('data:') || url === '') return true
    if (url.startsWith(PDF_SCHEME)) {
      const path = decodeURIComponent(url.slice(PDF_SCHEME.length))
      signedUrl(path)
        .then((u) => WebBrowser.openBrowserAsync(u))
        .catch((e) => Alert.alert('Could not open the PDF', e?.message ?? 'Please try again.'))
      return false
    }
    if (/^https?:\/\//.test(url)) void WebBrowser.openBrowserAsync(url)
    return false
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={palette.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        </View>
        <View style={{ flex: 1 }}>
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : loading || !source ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={accent} />
          ) : (
            <WebView
              originWhitelist={['*']}
              source={source}
              javaScriptEnabled={false}
              domStorageEnabled={false}
              allowFileAccess={false}
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={(req) => onLink(req.url)}
              style={{ flex: 1, backgroundColor: palette.surface }}
            />
          )}
        </View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  title: { fontSize: 17, fontWeight: '700', color: palette.text },
  subtitle: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
  error: { color: palette.danger, padding: 16 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    backgroundColor: palette.bg,
    borderBottomLeftRadius: radius.sm,
  },
})
