import { InstanceDto } from '@api/dto/instance.dto';
import { HandleLabelDto } from '@api/dto/label.dto';
import { WAMonitoringService } from '@api/services/monitor.service';

export class LabelController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  public async fetchLabels({ instanceName }: InstanceDto) {
    return await this.waMonitor.waInstances[instanceName].fetchLabels();
  }

  public async handleLabel({ instanceName }: InstanceDto, data: HandleLabelDto) {
    return await this.waMonitor.waInstances[instanceName].handleLabel(data);
  }

  /** [Lylead] Trae del servidor los cambios de listas pendientes (lectura, sin parches). */
  public async syncLabels({ instanceName }: InstanceDto) {
    const instance: any = this.waMonitor.waInstances[instanceName];
    if (!instance || typeof instance.syncLabelsFromServer !== 'function') {
      return { synced: false, fromVersion: null, toVersion: null, detail: 'este canal no admite etiquetas' };
    }
    return await instance.syncLabelsFromServer();
  }

  /** [Lylead] Solo lectura: ¿esta sesión puede escribir etiquetas sin arriesgar la vinculación? */
  public async labelWriteStatus({ instanceName }: InstanceDto) {
    const instance: any = this.waMonitor.waInstances[instanceName];
    if (!instance || typeof instance.labelWriteStatus !== 'function') {
      return { ready: false, detail: 'este canal no admite etiquetas', connection: null };
    }
    return await instance.labelWriteStatus();
  }
}
