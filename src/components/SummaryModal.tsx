import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";

interface SummaryModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  summary?: string;
}

export function SummaryModal({
  open,
  onClose,
  title = "Summary",
  summary,
}: SummaryModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[400px] mt-2 pr-2">
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
            {summary || "No summary available."}
          </pre>
        </ScrollArea>
        <div className="flex justify-end mt-4">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
