lwAddDevice("R1", 0, "2911", 100, 100);
lwAddDevice("R2", 0, "2911", 350, 100);
lwAddDevice("SW1", 1, "2960-24TT", 100, 250);
lwAddDevice("PC1", 8, "PC-PT", 20, 400);
lwAddDevice("PC2", 8, "PC-PT", 100, 400);
lwAddDevice("SW2", 1, "2960-24TT", 350, 250);
lwAddDevice("PC3", 8, "PC-PT", 270, 400);
lwAddDevice("PC4", 8, "PC-PT", 350, 400);
lwAddLink("R1", "GigabitEthernet0/0", "R2", "GigabitEthernet0/0", 8101);
lwAddLink("R1", "GigabitEthernet0/1", "SW1", "GigabitEthernet0/1", 8100);
lwAddLink("R2", "GigabitEthernet0/1", "SW2", "GigabitEthernet0/1", 8100);
lwAddLink("SW1", "FastEthernet0/1", "PC1", "FastEthernet0", 8100);
lwAddLink("SW1", "FastEthernet0/2", "PC2", "FastEthernet0", 8100);
lwAddLink("SW2", "FastEthernet0/1", "PC3", "FastEthernet0", 8100);
lwAddLink("SW2", "FastEthernet0/2", "PC4", "FastEthernet0", 8100);
/* === Configuraciones CLI por dispositivo ===
Copiar y pegar en la CLI de cada dispositivo. */
/* --- R1 ---
enable
configure terminal
hostname R1
no ip domain-lookup

interface GigabitEthernet0/0
 ip address 10.0.0.1 255.255.255.252
 no shutdown
 exit

interface GigabitEthernet0/1
 ip address 192.168.0.1 255.255.255.0
 no shutdown
 exit

ip dhcp excluded-address 192.168.0.1 192.168.0.1
ip dhcp pool LAN_R1_0
 network 192.168.0.0 255.255.255.0
 default-router 192.168.0.1
 dns-server 8.8.8.8
 exit

ip route 192.168.1.0 255.255.255.0 10.0.0.2

end
write memory
*/ 
/* --- R2 ---
enable
configure terminal
hostname R2
no ip domain-lookup

interface GigabitEthernet0/0
 ip address 10.0.0.2 255.255.255.252
 no shutdown
 exit

interface GigabitEthernet0/1
 ip address 192.168.1.1 255.255.255.0
 no shutdown
 exit

ip dhcp excluded-address 192.168.1.1 192.168.1.1
ip dhcp pool LAN_R2_0
 network 192.168.1.0 255.255.255.0
 default-router 192.168.1.1
 dns-server 8.8.8.8
 exit

ip route 192.168.0.0 255.255.255.0 10.0.0.1

end
write memory
*/ 
/* --- SW1 ---
enable
configure terminal
hostname SW1
end
write memory
*/ 
/* --- SW2 ---
enable
configure terminal
hostname SW2
end
write memory
*/ 