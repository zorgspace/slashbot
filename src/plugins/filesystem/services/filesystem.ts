/**
 * Re-export filesystem service from core (core owns this dependency).
 */
export {
  SecureFileSystem,
  createFileSystem,
  type FileOperation,
  type FileSystemConfig,
} from '../../../core/services/filesystem';
