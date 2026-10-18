import { useState } from 'react'

interface VideoPreviewProps {
  url: string
}

export default function VideoPreview({ url }: VideoPreviewProps) {
  // The failed state is remembered per URL, so opening another file resets it.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = failedUrl === url

  return (
    <div className="preview">
      <video
        key={url}
        src={url}
        controls
        preload="metadata"
        onError={() => setFailedUrl(url)}
      />
      {failed && (
        <p className="notice">
          Браузер не може відтворити цей файл (імовірно, кодек не
          підтримується). Дані про файл нижче прочитано окремо й залишаються
          доступними.
        </p>
      )}
    </div>
  )
}
