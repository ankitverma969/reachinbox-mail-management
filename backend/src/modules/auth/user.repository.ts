import { prisma } from '../../shared/database/prisma.client.js';
import type { User } from '@prisma/client';

export interface UpsertUserDto {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id }
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email }
    });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { googleId }
    });
  }

  async upsertGoogleUser(dto: UpsertUserDto): Promise<User> {
    const existingByEmail = await this.findByEmail(dto.email);
    if (existingByEmail) {
      return prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          googleId: dto.googleId,
          name: dto.name,
          avatarUrl: dto.avatarUrl ?? existingByEmail.avatarUrl
        }
      });
    }

    return prisma.user.upsert({
      where: { googleId: dto.googleId },
      update: {
        email: dto.email,
        name: dto.name,
        avatarUrl: dto.avatarUrl ?? null
      },
      create: {
        googleId: dto.googleId,
        email: dto.email,
        name: dto.name,
        avatarUrl: dto.avatarUrl ?? null
      }
    });
  }
}

export const userRepository = new UserRepository();
