/*
  # Create Assets Storage Bucket

  1. Storage
    - Create 'assets' storage bucket
    - Set up policies for file access

  2. Security
    - Allow authenticated users to upload files
    - Allow authenticated users to read files
    - Allow users to delete their own files
*/

-- Create the assets storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'assets');

-- Policy: Allow authenticated users to read files
CREATE POLICY "Authenticated users can read files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'assets');

-- Policy: Allow users to update their own files
CREATE POLICY "Users can update their own files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'assets' AND auth.uid()::text = owner);

-- Policy: Allow users to delete their own files
CREATE POLICY "Users can delete their own files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'assets' AND auth.uid()::text = owner);
