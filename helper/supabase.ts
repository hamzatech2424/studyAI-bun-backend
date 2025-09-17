import { createClient } from '@supabase/supabase-js'

// Check if we have the correct environment variables
const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL;
const bucketName = process.env.SUPABASE_BUCKET_NAME;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl!, supabaseServiceRoleKey!);

const fileUpload = async(file: File, buf: Buffer) => {
    if (!bucketName) {
        throw new Error("Bucket name is not set");
    }
    // // Ensure bucket exists before uploading
    const { data, error } = await supabase.storage.getBucket(bucketName); 
    console.log(data,"data==>>>")
    console.log(error,"Error==>>>")
    if (error) {
        throw new Error("Failed to create or access storage bucket");
    }
    const path = `${"pdfs"}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(path, buf, {
      contentType: file.type || "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    console.error("Supabase upload error:", uploadError);
    throw new Error(`File upload failed: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(path);

  return publicUrlData.publicUrl;
}

export { fileUpload };