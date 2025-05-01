import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { UploadIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  onFileSelected: (file: File) => void;
  acceptedFileTypes?: string;
  className?: string;
  maxSizeMB?: number;
}

export function FileUpload({
  onFileSelected,
  acceptedFileTypes = ".csv,.xlsx,.xls",
  className,
  maxSizeMB = 10
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndProcessFile(e.target.files[0]);
    }
  };

  const validateAndProcessFile = (file: File) => {
    setErrorMessage(null);
    
    // Check file type
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    const acceptedExtensions = acceptedFileTypes.split(',').map(type => 
      type.startsWith('.') ? type.substring(1) : type
    );
    
    if (!fileExtension || !acceptedExtensions.includes(fileExtension)) {
      setErrorMessage(`Invalid file type. Please upload ${acceptedFileTypes} files.`);
      return;
    }
    
    // Check file size
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setErrorMessage(`File is too large. Maximum size is ${maxSizeMB}MB.`);
      return;
    }
    
    // Pass the valid file to parent component
    onFileSelected(file);
  };

  const handleBrowseClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className={className}>
      <div
        className={cn(
          "border-2 border-dashed border-muted rounded-md p-8 text-center flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors duration-200",
          isDragging && "dropzone-active",
          errorMessage && "border-destructive"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
      >
        <UploadIcon className="h-10 w-10 text-muted-foreground mb-2" />
        <p className="text-sm mb-2">Drag & drop a CSV/Excel file here</p>
        <p className="text-xs text-muted-foreground">or</p>
        <Button variant="default" className="mt-4">Browse files</Button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept={acceptedFileTypes}
          className="hidden"
        />
      </div>
      
      {errorMessage && (
        <p className="text-sm text-destructive mt-2">{errorMessage}</p>
      )}
    </div>
  );
}
