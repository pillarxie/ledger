import { IsString } from 'class-validator';
import { PushDataDto } from './push-data.dto';

export class RestoreDataDto extends PushDataDto {
  @IsString()
  ownerId: string;
}
