import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  displayName:  { type: String, required: true },
  createdAt:    { type: Date, default: Date.now },
});

const User: Model<IUser> =
  mongoose.models.User ||
  mongoose.model<IUser>('User', UserSchema);

export default User;
