import { cn, Spinner } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

type PdfViewerProps = {
  file: File | null;
  url: string | null;
  className?: string;
};

export default function PdfViewer({ file, url, className }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>();
  const [isLoading, setIsLoading] = useState(true);
  const [containerWidth, setContainerWidth] = useState<number>(680);
  const containerRef = useRef<HTMLDivElement>(null);

  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }
    const created = URL.createObjectURL(file);
    setObjectUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);

  const pdfSource = objectUrl ?? url;

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col w-full rounded-lg border border-border bg-gradient-to-bl from-card from-50% via-card to-background dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)] text-card-foreground shadow-sm overflow-hidden",
        className
      )}
    >
      {isLoading && (
        <div className="flex items-center justify-center min-h-[400px]">
          <Spinner className="h-10 w-10" />
        </div>
      )}
      <div
        className={cn(
          "overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent max-h-[600px]",
          isLoading && "hidden"
        )}
      >
        <Document
          file={pdfSource}
          onLoadSuccess={({ numPages }) => {
            setNumPages(numPages);
            setIsLoading(false);
          }}
          onLoadError={() => setIsLoading(false)}
          loading={null}
        >
          {Array.from(new Array(numPages ?? 0), (_, index) => (
            <Page
              key={`page_${index + 1}`}
              pageNumber={index + 1}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              width={containerWidth}
            />
          ))}
        </Document>
      </div>
    </div>
  );
}
