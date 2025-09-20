import { createClient } from '@supabase/supabase-js'
import path from 'path';
import { randomUUID } from 'crypto';

// Check if we have the correct environment variables
const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL;
const bucketName = process.env.SUPABASE_BUCKET_NAME;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl!, supabaseServiceRoleKey!);

const fileUpload = async (file: File, buf: Buffer) => {
  if (!bucketName) {
    throw new Error("Bucket name is not set");
  }

  try {
    // Check if bucket exists
    const { data, error } = await supabase.storage.getBucket(bucketName);
    
    if (error) {
      throw new Error(`Failed to access storage bucket: ${error.message}`);
    }

    // Generate a completely safe filename
    const fileExtension = path.extname(file.name);
    const randomId = randomUUID();
    const safeFileName = `${randomId}${fileExtension}`;
    const fullPath = `pdfs/${safeFileName}`;

    console.log("📁 Safe filename:", safeFileName);
    console.log("📁 Full path:", fullPath);

    // Upload the file
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fullPath, buf, {
        contentType: file.type || "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`File upload failed: ${uploadError.message}`);
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fullPath);

    return publicUrlData.publicUrl;

  } catch (error) {
    console.error("❌ File upload error:", error);
    throw new Error(`Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
export { fileUpload };