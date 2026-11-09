// ============================================
// ScanImageBadge — Small clickable badge showing
// a camera icon on register entries created from AI scan.
// Clicking opens the original scanned image in a viewer overlay.
// ============================================

import { useState, useCallback } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { Camera, Loader2 } from 'lucide-react'

interface ScanImageBadgeProps {
  imagePath: string
}

export function ScanImageBadge({ imagePath }: ScanImageBadgeProps) {
  const [viewing, setViewing] = useState(false)
  
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()

    if (imageUrl) {
      setViewing(true)
      return
    }

    setLoading(true)
    try {
      const { data } = await getUserClient().storage
        .from('scan-images')
        .createSignedUrl(imagePath, 3600)

      if (data?.signedUrl) {
        setImageUrl(data.signedUrl)
        setViewing(true)
      }
    } catch (err) {
      console.error('Failed to load scan image:', err)
    } finally {
      setLoading(false)
    }
  }, [imagePath, imageUrl])

  return (
    <>
      <button
        className="scan-image-badge"
        onClick={handleClick}
        title="View scanned document"
        aria-label="View scanned document"
      >
        {loading ? <Loader2 size={14} strokeWidth={1.75} aria-hidden="true" /> : <Camera size={14} strokeWidth={1.75} aria-hidden="true" />}
      </button>

      {viewing && imageUrl && (
        <div
          className="scan-image-viewer"
          onClick={() => setViewing(false)}
        >
          <img src={imageUrl} alt="Scanned document" />
        </div>
      )}
    </>
  )
}
