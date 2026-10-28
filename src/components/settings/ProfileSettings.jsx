import { useEffect, useRef, useState } from 'react';
import { updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { toast } from 'react-toastify';
import { Camera, Mail, Phone, Save, User } from 'lucide-react';
import { db, storage } from '../../firebase';
import { useApp } from '../../context/AppContext';
import { Avatar, Button, Input } from '../ui';

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

const ProfileSettings = () => {
  const { user, profile, reloadUser } = useApp();
  const fileInput = useRef(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', phoneNumber: '' });
  const [photoFile, setPhotoFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (profile && !loaded) {
      setForm({ firstName: profile.firstName || '', lastName: profile.lastName || '', phoneNumber: profile.phoneNumber || '' });
      setLoaded(true);
    }
  }, [profile, loaded]);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const dirty =
    Boolean(photoFile) ||
    form.firstName !== (profile?.firstName || '') ||
    form.lastName !== (profile?.lastName || '') ||
    form.phoneNumber !== (profile?.phoneNumber || '');

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('Please choose an image under 3 MB.');
      return;
    }
    setPhotoFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First and last name are required.');
      return;
    }

    setSaving(true);
    try {
      let photoURL = user.photoURL;
      if (photoFile) {
        try {
          const storageRef = ref(storage, `users/${user.uid}/profile.jpg`);
          await uploadBytes(storageRef, photoFile);
          photoURL = await getDownloadURL(storageRef);
        } catch (err) {
          console.error('Photo upload failed:', err);
          toast.warning("Your photo couldn't be uploaded right now. Other changes were saved.");
        }
      }

      await updateProfile(user, { displayName: form.firstName.trim(), photoURL });
      await setDoc(
        doc(db, 'users', user.uid),
        { firstName: form.firstName.trim(), lastName: form.lastName.trim(), phoneNumber: form.phoneNumber.trim() },
        { merge: true }
      );
      await reloadUser();
      setPhotoFile(null);
      setPreview('');
      toast.success('Profile updated');
    } catch (err) {
      console.error('Error saving profile:', err);
      toast.error('Something went wrong while saving.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="flex items-center gap-5">
        <button type="button" onClick={() => fileInput.current?.click()} className="group relative rounded-full" aria-label="Change profile photo">
          <Avatar src={preview || user?.photoURL} name={`${form.firstName} ${form.lastName}`} size={84} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
            <Camera className="h-6 w-6" />
          </span>
          <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-on-accent ring-4 ring-surface">
            <Camera className="h-3.5 w-3.5" />
          </span>
        </button>
        <div>
          <p className="font-semibold">Profile photo</p>
          <p className="text-xs text-muted">JPG or PNG, up to 3 MB</p>
          <button type="button" onClick={() => fileInput.current?.click()} className="mt-1 text-sm font-semibold text-accent hover:underline">
            {preview ? 'Choose another' : 'Upload new photo'}
          </button>
        </div>
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="First name" icon={User} value={form.firstName} onChange={update('firstName')} autoComplete="given-name" />
        <Input label="Last name" value={form.lastName} onChange={update('lastName')} autoComplete="family-name" />
      </div>
      <Input label="Phone number" icon={Phone} type="tel" value={form.phoneNumber} onChange={update('phoneNumber')} autoComplete="tel" />
      <Input label="Email" icon={Mail} value={user?.email || ''} disabled hint="Contact support to change your email address." />

      <div className="flex justify-end">
        <Button type="submit" icon={Save} loading={saving} disabled={!dirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
};

export default ProfileSettings;
