import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';

class NotificationService {
  async initialize() {
    // Request permission for local notifications
    const localPermission = await LocalNotifications.requestPermissions();
    
    if (localPermission.display === 'granted') {
      // Register for push notifications
      await PushNotifications.register();

      // Listen for registration
      PushNotifications.addListener('registration', (token) => {
        console.log('Push registration success, token: ' + token.value);
        // Send token to backend
      });

      // Listen for push notification received
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push notification received: ', notification);
        this.showLocalNotification(
          notification.title || 'Notification',
          notification.body || ''
        );
      });

      // Listen for notification action performed
      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('Push notification action performed', notification);
      });
    }
  }

  async showLocalNotification(title: string, body: string, id?: number) {
    await LocalNotifications.schedule({
      notifications: [
        {
          title,
          body,
          id: id || Date.now(),
          schedule: { at: new Date(Date.now() + 100) },
          sound: undefined,
          attachments: undefined,
          actionTypeId: '',
          extra: null
        }
      ]
    });
  }

  async notifyPositionChange(childName: string, newPosition: number) {
    await this.showLocalNotification(
      'Queue Position Update',
      `${childName} is now #${newPosition} in line!`
    );
  }

  async notifyReadyForPickup(childName: string) {
    await this.showLocalNotification(
      '🎉 Ready for Pickup!',
      `${childName} is ready at the pickup area!`
    );
  }

  async notifyNextInLine(childName: string, estimatedTime: number) {
    await this.showLocalNotification(
      '⚡ Almost Your Turn!',
      `${childName} is next! Estimated ${estimatedTime} minutes.`
    );
  }
}

export default new NotificationService();
